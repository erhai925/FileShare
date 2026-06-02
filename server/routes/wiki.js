/**
 * Wiki 知识库模块路由 — /api/wiki/*
 *
 * 复用：authenticate / checkPermission / logOperation / files 库 / permissions 表 / spaces 表
 * 数据：wiki_pages / wiki_page_versions / wiki_tags / wiki_page_tags / wiki_favorites /
 *       wiki_page_views / wiki_page_links / wiki_page_attachments / wiki_subscriptions /
 *       wiki_comments；spaces.space_kind='wiki' 区分知识库
 *
 * 权限模型：两级混合（页面级覆盖 → 知识库级继承），见 middleware/auth.js checkPermission('wiki_page', ...)
 */

const express = require('express');
const db = require('../config/database');
const {
  authenticate,
  checkPermission,
  getBatchWikiPermissions
} = require('../middleware/auth');
const { logOperation } = require('../utils/logger');

const router = express.Router();

// ==================== 工具函数 ====================
const { generateSlug, ensureUniqueSlug, stripMarkdown } = require('../utils/wiki-internal');
const wikiNotify = require('../utils/wiki-notify');

/** 检查空间是否为 Wiki 知识库 */
async function getWikiSpace(spaceId) {
  return db.get(
    `SELECT * FROM spaces WHERE id = ? AND space_kind = 'wiki'`,
    [spaceId]
  );
}

/**
 * 知识库是否对当前用户可读：
 * team/部门知识库对所有登录用户开放只读；其余需 admin / owner / 显式 read 授权。
 * 写/删等仍走各自的 checkPermission，不在此放开。
 */
async function canReadWikiSpace(user, space) {
  if (user.role === 'admin') return true;
  if (space.owner_id === user.id) return true;
  if (space.type === 'team' || space.type === 'department') return true;
  return checkPermission(user.id, 'space', space.id, 'read');
}

/**
 * 知识库是否允许当前用户「贡献内容」（创建页面 / 恢复 / 导入等库级写动作）：
 * team/部门知识库对所有登录用户开放协作；其余需 admin / owner / 显式 write 授权。
 * 注意：改知识库信息、删库等「治理」动作不走这里，仍限 admin / owner（见对应路由）。
 */
async function canContributeWikiSpace(user, space) {
  if (user.role === 'admin') return true;
  if (space.owner_id === user.id) return true;
  if (space.type === 'team' || space.type === 'department') return true;
  return checkPermission(user.id, 'space', space.id, 'write');
}

// ==================== F1 知识库 CRUD ====================

/**
 * GET /api/wiki/spaces — 列出当前用户可见的 Wiki 知识库
 * 查询参数：type (team|department|personal|project)
 */
router.get('/spaces', authenticate, async (req, res) => {
  try {
    const { type } = req.query;
    let sql = `SELECT s.*, u.username AS owner_name, u.real_name AS owner_real_name,
        (SELECT COUNT(*) FROM wiki_pages wp WHERE wp.space_id = s.id AND wp.deleted_at IS NULL AND wp.archived_at IS NULL) AS page_count,
        (SELECT MAX(updated_at) FROM wiki_pages wp WHERE wp.space_id = s.id AND wp.deleted_at IS NULL) AS last_updated_at
      FROM spaces s
      LEFT JOIN users u ON s.owner_id = u.id
      WHERE s.space_kind = 'wiki'`;
    const params = [];
    if (type) {
      sql += ` AND s.type = ?`;
      params.push(type);
    }
    if (req.user.role !== 'admin') {
      // 团队/部门知识库全员可见；个人/项目仍需 owner 或显式授权
      sql += ` AND (s.type IN ('team','department') OR s.owner_id = ? OR EXISTS (
        SELECT 1 FROM permissions p
        WHERE p.resource_type = 'space' AND p.resource_id = s.id
        AND (p.user_id = ? OR p.group_id IN (
          SELECT group_id FROM user_group_members WHERE user_id = ?
        ))
      ))`;
      params.push(req.user.id, req.user.id, req.user.id);
    }
    sql += ` ORDER BY s.created_at DESC`;
    const rows = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取 Wiki 知识库列表失败:', error);
    res.status(500).json({ success: false, message: '获取知识库列表失败' });
  }
});

/**
 * POST /api/wiki/spaces — 新建知识库
 * body: { name, type, description, parentId? }
 */
router.post('/spaces', authenticate, async (req, res) => {
  try {
    const { name, type, description, parentId } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, message: '知识库名称和类型不能为空' });
    }
    if (!['team', 'department', 'personal', 'project'].includes(type)) {
      return res.status(400).json({ success: false, message: '知识库类型无效' });
    }
    // 所有登录用户均可创建任意类型知识库（含团队/部门）
    const result = await db.run(
      `INSERT INTO spaces (name, type, description, owner_id, parent_id, space_kind)
       VALUES (?, ?, ?, ?, ?, 'wiki')`,
      [name, type, description || null, req.user.id, parentId || null]
    );
    await logOperation(req.user.id, 'create_wiki_space', 'space', result.lastID, {
      name, type
    }, req);
    res.json({ success: true, message: '知识库创建成功', data: { spaceId: result.lastID } });
  } catch (error) {
    console.error('创建 Wiki 知识库失败:', error);
    res.status(500).json({ success: false, message: '创建知识库失败' });
  }
});

/**
 * GET /api/wiki/spaces/:id — 知识库详情（含统计与权限位）
 */
router.get('/spaces/:id', authenticate, async (req, res) => {
  try {
    const spaceId = parseInt(req.params.id);
    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });

    if (!(await canReadWikiSpace(req.user, space))) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }

    const owner = await db.get(`SELECT username, real_name FROM users WHERE id = ?`, [space.owner_id]);
    const pageCount = await db.get(
      `SELECT COUNT(*) AS c FROM wiki_pages WHERE space_id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
      [spaceId]
    );
    res.json({
      success: true,
      data: {
        ...space,
        owner_name: owner?.username,
        owner_real_name: owner?.real_name,
        page_count: pageCount?.c || 0
      }
    });
  } catch (error) {
    console.error('获取知识库详情失败:', error);
    res.status(500).json({ success: false, message: '获取知识库详情失败' });
  }
});

/**
 * PUT /api/wiki/spaces/:id — 修改知识库（仅 admin / owner / 有 write 权限者）
 */
router.put('/spaces/:id', authenticate, async (req, res) => {
  try {
    const spaceId = parseInt(req.params.id);
    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });

    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      const ok = await checkPermission(req.user.id, 'space', spaceId, 'write');
      if (!ok) return res.status(403).json({ success: false, message: '无修改权限' });
    }

    const { name, description, type } = req.body;
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (type !== undefined) {
      if (!['team', 'department', 'personal', 'project'].includes(type)) {
        return res.status(400).json({ success: false, message: '知识库类型无效' });
      }
      fields.push('type = ?'); params.push(type);
    }
    if (fields.length === 0) return res.json({ success: true, message: '无变更' });

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(spaceId);
    await db.run(`UPDATE spaces SET ${fields.join(', ')} WHERE id = ?`, params);
    await logOperation(req.user.id, 'update_wiki_space', 'space', spaceId, { fields: Object.keys(req.body) }, req);
    res.json({ success: true, message: '知识库已更新' });
  } catch (error) {
    console.error('更新知识库失败:', error);
    res.status(500).json({ success: false, message: '更新知识库失败' });
  }
});

/**
 * DELETE /api/wiki/spaces/:id — 删除知识库
 * 软删除策略：将知识库下所有页面 deleted_at 标记，知识库本身物理删除（与现有 spaces 行为对齐）；
 * 实际生产可改为知识库也加 deleted_at。M1 先采用：仅当库内无页面时允许删除，否则提示先清空。
 */
router.delete('/spaces/:id', authenticate, async (req, res) => {
  try {
    const spaceId = parseInt(req.params.id);
    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });

    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '只有管理员或所有者可以删除知识库' });
    }

    const remain = await db.get(
      `SELECT COUNT(*) AS c FROM wiki_pages WHERE space_id = ? AND deleted_at IS NULL`,
      [spaceId]
    );
    if (remain && remain.c > 0) {
      return res.status(400).json({
        success: false,
        message: `知识库下还有 ${remain.c} 个页面，请先删除或归档`
      });
    }

    await db.transaction(async () => {
      // 物理清理本库相关的所有数据（页面已经全部软删除，这里清理彻底删除的关联）
      await db.run(`DELETE FROM wiki_page_views WHERE page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?)`, [spaceId]);
      await db.run(`DELETE FROM wiki_page_versions WHERE page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?)`, [spaceId]);
      await db.run(`DELETE FROM wiki_page_tags WHERE page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?)`, [spaceId]);
      await db.run(`DELETE FROM wiki_favorites WHERE page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?)`, [spaceId]);
      await db.run(`DELETE FROM wiki_page_links WHERE source_page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?) OR target_page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?)`, [spaceId, spaceId]);
      await db.run(`DELETE FROM wiki_page_attachments WHERE page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?)`, [spaceId]);
      await db.run(`DELETE FROM wiki_comments WHERE page_id IN (SELECT id FROM wiki_pages WHERE space_id = ?)`, [spaceId]);
      await db.run(`DELETE FROM wiki_pages WHERE space_id = ?`, [spaceId]);
      await db.run(`DELETE FROM wiki_subscriptions WHERE target_type = 'space' AND target_id = ?`, [spaceId]);
      await db.run(`DELETE FROM permissions WHERE resource_type = 'space' AND resource_id = ?`, [spaceId]);
      await db.run(`DELETE FROM spaces WHERE id = ?`, [spaceId]);
    });
    await logOperation(req.user.id, 'delete_wiki_space', 'space', spaceId, { name: space.name }, req);
    res.json({ success: true, message: '知识库已删除' });
  } catch (error) {
    console.error('删除知识库失败:', error);
    res.status(500).json({ success: false, message: '删除知识库失败' });
  }
});

// ==================== F2/F17/F23 页面 CRUD + 树 + 草稿 + 归档 ====================

const QA_TEMPLATE_CONTENT = `## 问题描述

（请描述具体的问题现象）

## 环境与版本

- 系统/服务：
- 版本：
- 触发条件：

## 现象与日志

\`\`\`
（粘贴关键日志、错误堆栈或截图链接）
\`\`\`

## 原因分析

（解释问题的根因）

## 解决步骤

1.
2.
3.

## 验证方法

（如何确认问题已解决）

## 参考链接

-
`;

/**
 * GET /api/wiki/spaces/:id/tree — 知识库页面树（按 sort_order）
 * 支持 includeArchived/includeDraft 标记控制可见性
 */
router.get('/spaces/:id/tree', authenticate, async (req, res) => {
  try {
    const spaceId = parseInt(req.params.id);
    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });

    if (!(await canReadWikiSpace(req.user, space))) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }

    const includeArchived = req.query.includeArchived === '1';
    const includeDraft = req.query.includeDraft === '1';
    let sql = `SELECT id, parent_id, title, slug, status, archived_at, sort_order, view_count,
        updated_at, updated_by, created_by
      FROM wiki_pages WHERE space_id = ? AND deleted_at IS NULL`;
    const params = [spaceId];
    if (!includeArchived) sql += ` AND archived_at IS NULL`;
    // 草稿仅作者本人或 admin 可见
    if (!includeDraft) {
      if (req.user.role === 'admin') {
        // admin 看全部
      } else {
        sql += ` AND (status = 'published' OR created_by = ?)`;
        params.push(req.user.id);
      }
    }
    sql += ` ORDER BY parent_id ASC, sort_order ASC, id ASC`;
    const rows = await db.query(sql, params);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取页面树失败:', error);
    res.status(500).json({ success: false, message: '获取页面树失败' });
  }
});

/**
 * POST /api/wiki/pages — 新建页面
 * body: { spaceId, parentId?, title, content?, template?, tags?, status? }
 */
router.post('/pages', authenticate, async (req, res) => {
  try {
    const { spaceId, parentId, title, template = 'blank', tags = [], status = 'draft' } = req.body;
    let { content } = req.body;
    if (!spaceId || !title) {
      return res.status(400).json({ success: false, message: '空间ID和标题不能为空' });
    }

    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });

    if (!(await canContributeWikiSpace(req.user, space))) {
      return res.status(403).json({ success: false, message: '无写入权限' });
    }

    if (parentId) {
      const parent = await db.get(
        `SELECT space_id FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`,
        [parentId]
      );
      if (!parent) return res.status(400).json({ success: false, message: '父页面不存在' });
      if (parent.space_id !== spaceId) {
        return res.status(400).json({ success: false, message: '父页面与当前知识库不一致' });
      }
    }

    if (!['draft', 'published'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status 必须是 draft 或 published' });
    }

    if (!content && template === 'qa') content = QA_TEMPLATE_CONTENT;

    const baseSlug = generateSlug(title);
    const slug = await ensureUniqueSlug(spaceId, baseSlug);
    const contentText = stripMarkdown(content);

    const result = await db.transaction(async () => {
      const ins = await db.run(
        `INSERT INTO wiki_pages (space_id, parent_id, title, slug, content, content_text,
          status, template, sort_order, version, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM wiki_pages WHERE space_id = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'}), 0), 1, ?, ?)`,
        parentId
          ? [spaceId, parentId, title, slug, content || null, contentText, status, template, spaceId, parentId, req.user.id, req.user.id]
          : [spaceId, null, title, slug, content || null, contentText, status, template, spaceId, req.user.id, req.user.id]
      );

      // published 时写入第 1 版历史
      if (status === 'published') {
        await db.run(
          `INSERT INTO wiki_page_versions (page_id, version, title, content, change_note, created_by)
           VALUES (?, 1, ?, ?, '初始版本', ?)`,
          [ins.lastID, title, content || null, req.user.id]
        );
      }

      // 标签关联
      if (Array.isArray(tags) && tags.length > 0) {
        for (const tagName of tags) {
          if (!tagName || typeof tagName !== 'string') continue;
          let tagRow = await db.get(`SELECT id FROM wiki_tags WHERE name = ?`, [tagName.trim()]);
          if (!tagRow) {
            const tIns = await db.run(`INSERT INTO wiki_tags (name) VALUES (?)`, [tagName.trim()]);
            tagRow = { id: tIns.lastID };
          }
          await db.run(
            `INSERT OR IGNORE INTO wiki_page_tags (page_id, tag_id) VALUES (?, ?)`,
            [ins.lastID, tagRow.id]
          );
        }
      }
      return ins.lastID;
    });

    await logOperation(req.user.id, 'create_wiki_page', 'wiki_page', result, {
      spaceId, title, status, template
    }, req);

    // 仅 published 状态触发订阅通知（草稿不通知）
    if (status === 'published') {
      wikiNotify.notifyAllOnPageUpdate(req.user.id, {
        id: result, title, space_id: spaceId
      }, 'create').catch(() => {});
    }

    res.json({ success: true, message: '页面已创建', data: { pageId: result, slug } });
  } catch (error) {
    console.error('创建页面失败:', error);
    res.status(500).json({ success: false, message: '创建页面失败' });
  }
});

/**
 * PUT /api/wiki/pages/:id — 更新页面（含版本写入）
 * body: { title?, content?, tags?, expectedVersion (required), changeNote? }
 *
 * F15 乐观锁：传入 expectedVersion 与 wiki_pages.version 不一致时返回 409 + 当前最新内容
 */
router.put('/pages/:id', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(
      `SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`,
      [pageId]
    );
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });

    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无写入权限' });

    const { title, content, tags, expectedVersion, changeNote } = req.body;
    if (typeof expectedVersion !== 'number') {
      return res.status(400).json({ success: false, message: 'expectedVersion 必填' });
    }

    if (page.version !== expectedVersion) {
      return res.status(409).json({
        success: false,
        message: '页面已被他人更新',
        conflict: true,
        data: {
          currentVersion: page.version,
          currentTitle: page.title,
          currentContent: page.content,
          updatedBy: page.updated_by,
          updatedAt: page.updated_at
        }
      });
    }

    const newTitle = title !== undefined ? title : page.title;
    const newContent = content !== undefined ? content : page.content;
    const contentText = stripMarkdown(newContent);
    const newVersion = page.version + 1;

    await db.transaction(async () => {
      await db.run(
        `UPDATE wiki_pages SET title = ?, content = ?, content_text = ?, version = ?,
           status = 'published', updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newTitle, newContent, contentText, newVersion, req.user.id, pageId]
      );
      await db.run(
        `INSERT INTO wiki_page_versions (page_id, version, title, content, change_note, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pageId, newVersion, newTitle, newContent, changeNote || null, req.user.id]
      );

      // 标签同步：传入 tags 数组时整体替换
      if (Array.isArray(tags)) {
        await db.run(`DELETE FROM wiki_page_tags WHERE page_id = ?`, [pageId]);
        for (const tagName of tags) {
          if (!tagName || typeof tagName !== 'string') continue;
          let tagRow = await db.get(`SELECT id FROM wiki_tags WHERE name = ?`, [tagName.trim()]);
          if (!tagRow) {
            const tIns = await db.run(`INSERT INTO wiki_tags (name) VALUES (?)`, [tagName.trim()]);
            tagRow = { id: tIns.lastID };
          }
          await db.run(
            `INSERT OR IGNORE INTO wiki_page_tags (page_id, tag_id) VALUES (?, ?)`,
            [pageId, tagRow.id]
          );
        }
      }

      // 解析正文中的 [[Page]] 内链，更新 wiki_page_links
      await rebuildPageLinks(pageId, newContent, page.space_id);
    });

    await logOperation(req.user.id, 'update_wiki_page', 'wiki_page', pageId, {
      version: newVersion, changeNote: changeNote || null
    }, req);

    // 订阅者通知（前端红点，best-effort）
    wikiNotify.notifyAllOnPageUpdate(req.user.id, {
      id: pageId, title: newTitle, space_id: page.space_id
    }, 'update').catch(() => {});

    res.json({ success: true, message: '页面已更新', data: { version: newVersion } });
  } catch (error) {
    console.error('更新页面失败:', error);
    res.status(500).json({ success: false, message: '更新页面失败' });
  }
});

/** 解析正文中的 [[Page]] 内链，重建 wiki_page_links（同库内匹配 title 或 slug） */
async function rebuildPageLinks(pageId, content, spaceId) {
  await db.run(`DELETE FROM wiki_page_links WHERE source_page_id = ?`, [pageId]);
  if (!content) return;
  const re = /\[\[([^\]]+)\]\]/g;
  const targets = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    const key = m[1].trim();
    if (key) targets.add(key);
  }
  for (const key of targets) {
    const target = await db.get(
      `SELECT id FROM wiki_pages WHERE space_id = ? AND deleted_at IS NULL
        AND (title = ? OR slug = ?) ORDER BY updated_at DESC LIMIT 1`,
      [spaceId, key, key.toLowerCase()]
    );
    if (target && target.id !== pageId) {
      await db.run(
        `INSERT OR IGNORE INTO wiki_page_links (source_page_id, target_page_id) VALUES (?, ?)`,
        [pageId, target.id]
      );
    }
  }
}

/**
 * PUT /api/wiki/pages/:id/draft — 仅保存草稿（不写版本，不递增 version）
 * body: { content }
 */
router.put('/pages/:id/draft', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });

    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无写入权限' });

    const { content, title } = req.body;
    await db.run(
      `UPDATE wiki_pages SET draft_content = ?, ${title !== undefined ? 'title = ?, ' : ''}updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      title !== undefined ? [content || null, title, req.user.id, pageId] : [content || null, req.user.id, pageId]
    );
    res.json({ success: true, message: '草稿已保存' });
  } catch (error) {
    console.error('保存草稿失败:', error);
    res.status(500).json({ success: false, message: '保存草稿失败' });
  }
});

/**
 * POST /api/wiki/pages/:id/publish — 草稿发布为新版本（用 draft_content 升级 content）
 * body: { changeNote? }
 */
router.post('/pages/:id/publish', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });

    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无写入权限' });

    const newContent = page.draft_content !== null && page.draft_content !== undefined
      ? page.draft_content
      : page.content;
    const newVersion = page.version + 1;
    const contentText = stripMarkdown(newContent);

    await db.transaction(async () => {
      await db.run(
        `UPDATE wiki_pages SET content = ?, content_text = ?, draft_content = NULL,
           version = ?, status = 'published', updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newContent, contentText, newVersion, req.user.id, pageId]
      );
      await db.run(
        `INSERT INTO wiki_page_versions (page_id, version, title, content, change_note, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pageId, newVersion, page.title, newContent, req.body.changeNote || '发布草稿', req.user.id]
      );
      await rebuildPageLinks(pageId, newContent, page.space_id);
    });

    await logOperation(req.user.id, 'publish_wiki_page', 'wiki_page', pageId, { version: newVersion }, req);
    wikiNotify.notifyAllOnPageUpdate(req.user.id, {
      id: pageId, title: page.title, space_id: page.space_id
    }, 'publish').catch(() => {});
    res.json({ success: true, message: '已发布', data: { version: newVersion } });
  } catch (error) {
    console.error('发布失败:', error);
    res.status(500).json({ success: false, message: '发布失败' });
  }
});

/**
 * GET /api/wiki/pages/:id — 页面详情
 * query: includeDraft=1 时（仅作者/admin）返回 draft_content
 */
router.get('/pages/:id', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(
      `SELECT p.*, u.username AS updated_by_name, u.real_name AS updated_by_real_name,
         c.username AS created_by_name, c.real_name AS created_by_real_name,
         s.name AS space_name
       FROM wiki_pages p
       LEFT JOIN users u ON p.updated_by = u.id
       LEFT JOIN users c ON p.created_by = c.id
       LEFT JOIN spaces s ON p.space_id = s.id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [pageId]
    );
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });

    // 草稿仅作者 / admin 可见
    if (page.status === 'draft' && req.user.role !== 'admin' && page.created_by !== req.user.id) {
      return res.status(404).json({ success: false, message: '页面不存在' });
    }

    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    // 标签
    const tags = await db.query(
      `SELECT t.id, t.name, t.color FROM wiki_tags t
       INNER JOIN wiki_page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?`,
      [pageId]
    );

    // 是否收藏
    const fav = await db.get(
      `SELECT 1 FROM wiki_favorites WHERE user_id = ? AND page_id = ?`,
      [req.user.id, pageId]
    );

    // 反向链接
    const backlinks = await db.query(
      `SELECT p.id, p.title, p.slug FROM wiki_page_links l
       INNER JOIN wiki_pages p ON l.source_page_id = p.id
       WHERE l.target_page_id = ? AND p.deleted_at IS NULL`,
      [pageId]
    );

    // 附件
    const attachments = await db.query(
      `SELECT a.id, a.file_id, a.sort_order, a.created_at,
          f.original_name, f.file_size, f.mime_type, u.username AS uploader_name
       FROM wiki_page_attachments a
       INNER JOIN files f ON a.file_id = f.id
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.page_id = ? AND f.deleted_at IS NULL
       ORDER BY a.sort_order ASC, a.created_at ASC`,
      [pageId]
    );

    // 当前用户对页面的权限位（用于前端显示按钮）
    const perms = (await getBatchWikiPermissions(req.user.id, [page]))[pageId];

    // 是否包含 draft
    const includeDraft = req.query.includeDraft === '1' &&
      (req.user.role === 'admin' || page.created_by === req.user.id);

    res.json({
      success: true,
      data: {
        ...page,
        draft_content: includeDraft ? page.draft_content : undefined,
        tags,
        is_favorited: !!fav,
        backlinks,
        attachments,
        permissions: perms
      }
    });
  } catch (error) {
    console.error('获取页面详情失败:', error);
    res.status(500).json({ success: false, message: '获取页面详情失败' });
  }
});

/**
 * GET /api/wiki/pages/by-slug/:spaceId/:slug — 按 slug 查询（前端 URL 友好路由）
 */
router.get('/pages/by-slug/:spaceId/:slug', authenticate, async (req, res) => {
  try {
    const spaceId = parseInt(req.params.spaceId);
    const slug = req.params.slug;
    const row = await db.get(
      `SELECT id FROM wiki_pages WHERE space_id = ? AND slug = ? AND deleted_at IS NULL`,
      [spaceId, slug]
    );
    if (!row) return res.status(404).json({ success: false, message: '页面不存在' });
    req.params.id = row.id;
    return router.handle(Object.assign(req, { url: `/pages/${row.id}`, originalUrl: `/api/wiki/pages/${row.id}` }), res, () => {});
  } catch (error) {
    console.error('按 slug 查询页面失败:', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * DELETE /api/wiki/pages/:id — 软删除（含子树级联）
 */
router.delete('/pages/:id', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });

    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'delete');
    if (!ok) return res.status(403).json({ success: false, message: '无删除权限' });

    // BFS 收集子树
    const ids = [pageId];
    let queue = [pageId];
    while (queue.length > 0) {
      const placeholders = queue.map(() => '?').join(',');
      const children = await db.query(
        `SELECT id FROM wiki_pages WHERE parent_id IN (${placeholders}) AND deleted_at IS NULL`,
        queue
      );
      const childIds = children.map(c => c.id);
      ids.push(...childIds);
      queue = childIds;
    }
    const ph = ids.map(() => '?').join(',');
    await db.run(`UPDATE wiki_pages SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${ph})`, ids);
    await logOperation(req.user.id, 'delete_wiki_page', 'wiki_page', pageId, {
      title: page.title, cascadedCount: ids.length - 1
    }, req);
    res.json({ success: true, message: '已移到回收站', data: { deletedCount: ids.length } });
  } catch (error) {
    console.error('删除页面失败:', error);
    res.status(500).json({ success: false, message: '删除页面失败' });
  }
});

/**
 * POST /api/wiki/pages/:id/restore — 从回收站恢复（含子树级联，原父丢失则恢复到根）
 */
router.post('/pages/:id/restore', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ?`, [pageId]);
    if (!page || page.deleted_at === null) {
      return res.status(404).json({ success: false, message: '页面不在回收站中' });
    }

    const rspace = await db.get(`SELECT id, owner_id, type FROM spaces WHERE id = ?`, [page.space_id]);
    if (!rspace || !(await canContributeWikiSpace(req.user, rspace))) {
      return res.status(403).json({ success: false, message: '无恢复权限' });
    }

    // 收集本次软删除时一起被删的子树（deleted_at 与本节点同值/同窗口）
    const ids = [pageId];
    let queue = [pageId];
    while (queue.length > 0) {
      const placeholders = queue.map(() => '?').join(',');
      const children = await db.query(
        `SELECT id FROM wiki_pages WHERE parent_id IN (${placeholders}) AND deleted_at IS NOT NULL`,
        queue
      );
      const childIds = children.map(c => c.id);
      ids.push(...childIds);
      queue = childIds;
    }

    // 父页面已彻底丢失则置为 NULL（恢复到根）
    let resetParent = false;
    if (page.parent_id) {
      const parent = await db.get(`SELECT id, deleted_at FROM wiki_pages WHERE id = ?`, [page.parent_id]);
      if (!parent || parent.deleted_at !== null) resetParent = true;
    }

    const ph = ids.map(() => '?').join(',');
    await db.transaction(async () => {
      await db.run(`UPDATE wiki_pages SET deleted_at = NULL WHERE id IN (${ph})`, ids);
      if (resetParent) {
        await db.run(`UPDATE wiki_pages SET parent_id = NULL WHERE id = ?`, [pageId]);
      }
    });
    await logOperation(req.user.id, 'restore_wiki_page', 'wiki_page', pageId, {
      restoredCount: ids.length, parentReset: resetParent
    }, req);
    res.json({ success: true, message: '已恢复', data: { restoredCount: ids.length, parentReset: resetParent } });
  } catch (error) {
    console.error('恢复页面失败:', error);
    res.status(500).json({ success: false, message: '恢复页面失败' });
  }
});

/**
 * DELETE /api/wiki/pages/:id/permanent — 彻底删除（admin 或空间所有者）
 */
router.delete('/pages/:id/permanent', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ?`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });
    if (page.deleted_at === null) {
      return res.status(400).json({ success: false, message: '请先软删除再彻底删除' });
    }

    const space = await db.get(`SELECT owner_id FROM spaces WHERE id = ?`, [page.space_id]);
    if (req.user.role !== 'admin' && space?.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '只有管理员或空间所有者可以彻底删除' });
    }

    await db.transaction(async () => {
      await db.run(`DELETE FROM wiki_page_versions WHERE page_id = ?`, [pageId]);
      await db.run(`DELETE FROM wiki_page_views WHERE page_id = ?`, [pageId]);
      await db.run(`DELETE FROM wiki_page_tags WHERE page_id = ?`, [pageId]);
      await db.run(`DELETE FROM wiki_favorites WHERE page_id = ?`, [pageId]);
      await db.run(`DELETE FROM wiki_page_links WHERE source_page_id = ? OR target_page_id = ?`, [pageId, pageId]);
      await db.run(`DELETE FROM wiki_page_attachments WHERE page_id = ?`, [pageId]);
      await db.run(`DELETE FROM wiki_comments WHERE page_id = ?`, [pageId]);
      await db.run(`DELETE FROM wiki_subscriptions WHERE target_type = 'page' AND target_id = ?`, [pageId]);
      await db.run(`DELETE FROM permissions WHERE resource_type = 'wiki_page' AND resource_id = ?`, [pageId]);
      await db.run(`DELETE FROM wiki_pages WHERE id = ?`, [pageId]);
    });
    await logOperation(req.user.id, 'permanent_delete_wiki_page', 'wiki_page', pageId, { title: page.title }, req);
    res.json({ success: true, message: '页面已彻底删除' });
  } catch (error) {
    console.error('彻底删除页面失败:', error);
    res.status(500).json({ success: false, message: '彻底删除失败' });
  }
});

/**
 * POST /api/wiki/pages/:id/move — 移动（更换 parent_id 或 sort_order）
 * body: { parentId?: number|null, sortOrder?: number }
 */
router.post('/pages/:id/move', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });

    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无修改权限' });

    const { parentId, sortOrder } = req.body;
    if (parentId !== undefined && parentId !== null) {
      // 不能把自己设为子孙的子页面
      let cur = parentId;
      while (cur) {
        if (cur === pageId) {
          return res.status(400).json({ success: false, message: '不能将页面移动到其子页面下' });
        }
        const p = await db.get(`SELECT parent_id, space_id FROM wiki_pages WHERE id = ?`, [cur]);
        if (!p) return res.status(400).json({ success: false, message: '父页面不存在' });
        if (p.space_id !== page.space_id) {
          return res.status(400).json({ success: false, message: '不能跨知识库移动' });
        }
        cur = p.parent_id;
      }
    }

    const fields = [];
    const params = [];
    if (parentId !== undefined) { fields.push('parent_id = ?'); params.push(parentId); }
    if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(sortOrder); }
    if (fields.length === 0) return res.json({ success: true, message: '无变更' });
    fields.push('updated_at = CURRENT_TIMESTAMP');
    fields.push('updated_by = ?'); params.push(req.user.id);
    params.push(pageId);
    await db.run(`UPDATE wiki_pages SET ${fields.join(', ')} WHERE id = ?`, params);
    await logOperation(req.user.id, 'move_wiki_page', 'wiki_page', pageId, { parentId, sortOrder }, req);
    res.json({ success: true, message: '已移动' });
  } catch (error) {
    console.error('移动页面失败:', error);
    res.status(500).json({ success: false, message: '移动页面失败' });
  }
});

/** F23 — 归档 / 取消归档 */
router.post('/pages/:id/archive', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无操作权限' });
    await db.run(`UPDATE wiki_pages SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [pageId]);
    await logOperation(req.user.id, 'archive_wiki_page', 'wiki_page', pageId, {}, req);
    res.json({ success: true, message: '已归档' });
  } catch (error) {
    console.error('归档失败:', error);
    res.status(500).json({ success: false, message: '归档失败' });
  }
});
router.post('/pages/:id/unarchive', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无操作权限' });
    await db.run(`UPDATE wiki_pages SET archived_at = NULL WHERE id = ?`, [pageId]);
    await logOperation(req.user.id, 'unarchive_wiki_page', 'wiki_page', pageId, {}, req);
    res.json({ success: true, message: '已取消归档' });
  } catch (error) {
    console.error('取消归档失败:', error);
    res.status(500).json({ success: false, message: '取消归档失败' });
  }
});

/** GET /api/wiki/trash — 回收站列表 */
router.get('/trash', authenticate, async (req, res) => {
  try {
    const spaceId = req.query.spaceId ? parseInt(req.query.spaceId) : null;
    let sql = `SELECT p.id, p.title, p.slug, p.space_id, p.parent_id, p.deleted_at,
        s.name AS space_name, u.username AS deleter_name
      FROM wiki_pages p
      LEFT JOIN spaces s ON p.space_id = s.id
      LEFT JOIN users u ON p.updated_by = u.id
      WHERE p.deleted_at IS NOT NULL`;
    const params = [];
    if (spaceId) { sql += ` AND p.space_id = ?`; params.push(spaceId); }
    if (req.user.role !== 'admin') {
      sql += ` AND (p.created_by = ? OR EXISTS (
        SELECT 1 FROM permissions pm WHERE pm.resource_type = 'space' AND pm.resource_id = p.space_id
        AND (pm.user_id = ? OR pm.group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?))
      ) OR EXISTS (SELECT 1 FROM spaces ss WHERE ss.id = p.space_id AND ss.owner_id = ?))`;
      params.push(req.user.id, req.user.id, req.user.id, req.user.id);
    }
    sql += ` ORDER BY p.deleted_at DESC LIMIT 200`;
    const rows = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取回收站失败:', error);
    res.status(500).json({ success: false, message: '获取回收站失败' });
  }
});

// ==================== F4/F15 版本历史 + diff + 回滚 ====================

/** GET /pages/:id/versions — 版本列表 */
router.get('/pages/:id/versions', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const versions = await db.query(
      `SELECT v.id, v.version, v.title, v.change_note, v.created_at, v.created_by,
         u.username AS author_name, u.real_name AS author_real_name
       FROM wiki_page_versions v
       LEFT JOIN users u ON v.created_by = u.id
       WHERE v.page_id = ? ORDER BY v.version DESC`,
      [pageId]
    );
    res.json({ success: true, data: versions });
  } catch (error) {
    console.error('获取版本列表失败:', error);
    res.status(500).json({ success: false, message: '获取版本列表失败' });
  }
});

/** GET /pages/:id/versions/:v — 单版本内容 */
router.get('/pages/:id/versions/:v', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const v = parseInt(req.params.v);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const row = await db.get(
      `SELECT v.*, u.username AS author_name, u.real_name AS author_real_name
       FROM wiki_page_versions v LEFT JOIN users u ON v.created_by = u.id
       WHERE v.page_id = ? AND v.version = ?`,
      [pageId, v]
    );
    if (!row) return res.status(404).json({ success: false, message: '版本不存在' });
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('获取版本失败:', error);
    res.status(500).json({ success: false, message: '获取版本失败' });
  }
});

/** GET /pages/:id/diff?from=&to= — diff（前端用 diff 库渲染） */
router.get('/pages/:id/diff', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const from = parseInt(req.query.from);
    const to = parseInt(req.query.to);
    if (!from || !to) return res.status(400).json({ success: false, message: 'from / to 必填' });
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const [a, b] = await Promise.all([
      db.get(`SELECT version, title, content FROM wiki_page_versions WHERE page_id = ? AND version = ?`, [pageId, from]),
      db.get(`SELECT version, title, content FROM wiki_page_versions WHERE page_id = ? AND version = ?`, [pageId, to])
    ]);
    if (!a || !b) return res.status(404).json({ success: false, message: '版本不存在' });
    res.json({ success: true, data: { from: a, to: b } });
  } catch (error) {
    console.error('获取 diff 失败:', error);
    res.status(500).json({ success: false, message: '获取 diff 失败' });
  }
});

/** POST /pages/:id/rollback/:v — 回滚到指定版本（生成新版本号，不删除中间版本） */
router.post('/pages/:id/rollback/:v', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const v = parseInt(req.params.v);
    const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ? AND deleted_at IS NULL`, [pageId]);
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无写入权限' });

    const old = await db.get(
      `SELECT title, content FROM wiki_page_versions WHERE page_id = ? AND version = ?`,
      [pageId, v]
    );
    if (!old) return res.status(404).json({ success: false, message: '目标版本不存在' });

    const newVersion = page.version + 1;
    const contentText = stripMarkdown(old.content);
    await db.transaction(async () => {
      await db.run(
        `UPDATE wiki_pages SET title = ?, content = ?, content_text = ?, version = ?,
           status = 'published', updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [old.title, old.content, contentText, newVersion, req.user.id, pageId]
      );
      await db.run(
        `INSERT INTO wiki_page_versions (page_id, version, title, content, change_note, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pageId, newVersion, old.title, old.content, `回滚自 v${v}`, req.user.id]
      );
      await rebuildPageLinks(pageId, old.content, page.space_id);
    });
    await logOperation(req.user.id, 'rollback_wiki_page', 'wiki_page', pageId, { from: v, to: newVersion }, req);
    wikiNotify.notifyAllOnPageUpdate(req.user.id, {
      id: pageId, title: old.title, space_id: page.space_id
    }, 'rollback').catch(() => {});
    res.json({ success: true, message: '回滚成功', data: { version: newVersion } });
  } catch (error) {
    console.error('回滚失败:', error);
    res.status(500).json({ success: false, message: '回滚失败' });
  }
});

// ==================== F5 全文搜索 ====================

/** GET /api/wiki/search */
router.get('/search', authenticate, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const spaceId = req.query.spaceId ? parseInt(req.query.spaceId) : null;
    const tag = req.query.tag ? req.query.tag.toString().trim() : null;
    const author = req.query.author ? parseInt(req.query.author) : null;
    const from = req.query.from ? req.query.from.toString() : null;
    const to = req.query.to ? req.query.to.toString() : null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20));

    const where = [`p.deleted_at IS NULL`, `p.archived_at IS NULL`, `p.status = 'published'`];
    const params = [];
    if (q) {
      where.push(`(p.title LIKE ? OR p.content_text LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`);
    }
    if (spaceId) { where.push(`p.space_id = ?`); params.push(spaceId); }
    if (author) { where.push(`p.created_by = ?`); params.push(author); }
    if (from) { where.push(`p.updated_at >= ?`); params.push(from); }
    if (to) { where.push(`p.updated_at <= ?`); params.push(to); }
    if (tag) {
      where.push(`p.id IN (SELECT pt.page_id FROM wiki_page_tags pt INNER JOIN wiki_tags t ON pt.tag_id = t.id WHERE t.name = ?)`);
      params.push(tag);
    }

    // 权限过滤：admin 看全部；否则限制在用户可访问的知识库范围内
    if (req.user.role !== 'admin') {
      where.push(`(p.created_by = ?
        OR EXISTS (SELECT 1 FROM spaces s WHERE s.id = p.space_id AND s.type IN ('team','department'))
        OR EXISTS (SELECT 1 FROM spaces s WHERE s.id = p.space_id AND s.owner_id = ?)
        OR EXISTS (SELECT 1 FROM permissions pm WHERE pm.resource_type = 'space' AND pm.resource_id = p.space_id
          AND (pm.user_id = ? OR pm.group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?)) AND pm.permission_type = 'read')
        OR EXISTS (SELECT 1 FROM permissions pm WHERE pm.resource_type = 'wiki_page' AND pm.resource_id = p.id
          AND (pm.user_id = ? OR pm.group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?)) AND pm.permission_type = 'read'))`);
      params.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
    }

    const whereSql = where.join(' AND ');
    const orderRel = q
      ? `CASE WHEN p.title = ? THEN 0 WHEN p.title LIKE ? THEN 1 ELSE 2 END,`
      : '';
    const orderParams = q ? [q, `%${q}%`] : [];

    const sql = `SELECT p.id, p.space_id, p.title, p.slug, p.content_text, p.updated_at, p.view_count,
        s.name AS space_name, u.username AS author_name
      FROM wiki_pages p
      LEFT JOIN spaces s ON p.space_id = s.id
      LEFT JOIN users u ON p.updated_by = u.id
      WHERE ${whereSql}
      ORDER BY ${orderRel} p.updated_at DESC
      LIMIT ? OFFSET ?`;
    const rows = await db.query(sql, [...params, ...orderParams, pageSize, (page - 1) * pageSize]);

    const total = (await db.get(`SELECT COUNT(*) AS c FROM wiki_pages p WHERE ${whereSql}`, params))?.c || 0;

    // 命中片段提取（简单实现：取首个匹配位置前后各 30 字符）
    const results = rows.map(r => {
      let snippet = '';
      if (q && r.content_text) {
        const idx = r.content_text.toLowerCase().indexOf(q.toLowerCase());
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(r.content_text.length, idx + q.length + 30);
          snippet = (start > 0 ? '...' : '') + r.content_text.slice(start, end) + (end < r.content_text.length ? '...' : '');
        } else {
          snippet = (r.content_text || '').slice(0, 80);
        }
      } else {
        snippet = (r.content_text || '').slice(0, 80);
      }
      return { ...r, snippet, content_text: undefined };
    });

    res.json({
      success: true,
      data: results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (error) {
    console.error('搜索失败:', error);
    res.status(500).json({ success: false, message: '搜索失败' });
  }
});

// ==================== F6 评论（独立 wiki_comments 表） ====================

/** GET /api/wiki/pages/:id/comments — 获取页面评论 */
router.get('/pages/:id/comments', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const rows = await db.query(
      `SELECT c.*, u.username, u.real_name, u.avatar
       FROM wiki_comments c LEFT JOIN users u ON c.user_id = u.id
       WHERE c.page_id = ? ORDER BY c.created_at ASC`,
      [pageId]
    );
    const data = rows.map(c => ({
      ...c,
      mentioned_users: c.mentioned_users ? JSON.parse(c.mentioned_users) : null
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取评论失败:', error);
    res.status(500).json({ success: false, message: '获取评论失败' });
  }
});

/** POST /api/wiki/pages/:id/comments — 添加评论 */
router.post('/pages/:id/comments', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const { content, mentionedUsers, parentId } = req.body;
    if (!content) return res.status(400).json({ success: false, message: '评论内容不能为空' });

    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'comment');
    if (!ok) return res.status(403).json({ success: false, message: '无评论权限' });

    const ins = await db.run(
      `INSERT INTO wiki_comments (page_id, user_id, content, mentioned_users, parent_id)
       VALUES (?, ?, ?, ?, ?)`,
      [pageId, req.user.id, content, mentionedUsers ? JSON.stringify(mentionedUsers) : null, parentId || null]
    );
    await logOperation(req.user.id, 'add_wiki_comment', 'wiki_page', pageId, { commentId: ins.lastID }, req);
    // @ 提及通知（前端红点）
    if (Array.isArray(mentionedUsers) && mentionedUsers.length > 0) {
      const page = await db.get(`SELECT title, space_id FROM wiki_pages WHERE id = ?`, [pageId]);
      wikiNotify.notifyMention(req.user.id, pageId, mentionedUsers, {
        title: page?.title, spaceId: page?.space_id, commentId: ins.lastID
      }).catch(() => {});
    }
    res.json({ success: true, message: '评论已发表', data: { commentId: ins.lastID } });
  } catch (error) {
    console.error('发表评论失败:', error);
    res.status(500).json({ success: false, message: '发表评论失败' });
  }
});

/** DELETE /api/wiki/comments/:commentId */
router.delete('/comments/:commentId', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.commentId);
    const c = await db.get(`SELECT * FROM wiki_comments WHERE id = ?`, [id]);
    if (!c) return res.status(404).json({ success: false, message: '评论不存在' });
    if (c.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '只能删除自己的评论' });
    }
    await db.run(`DELETE FROM wiki_comments WHERE id = ?`, [id]);
    await logOperation(req.user.id, 'delete_wiki_comment', 'wiki_page', c.page_id, { commentId: id }, req);
    res.json({ success: true, message: '评论已删除' });
  } catch (error) {
    console.error('删除评论失败:', error);
    res.status(500).json({ success: false, message: '删除评论失败' });
  }
});

// ==================== F16 附件管理 ====================

/** GET /pages/:id/attachments */
router.get('/pages/:id/attachments', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const rows = await db.query(
      `SELECT a.id, a.file_id, a.sort_order, a.created_at,
          f.original_name, f.file_size, f.mime_type, u.username AS uploader_name
       FROM wiki_page_attachments a
       INNER JOIN files f ON a.file_id = f.id
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.page_id = ? AND f.deleted_at IS NULL
       ORDER BY a.sort_order ASC, a.created_at ASC`,
      [pageId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取附件失败:', error);
    res.status(500).json({ success: false, message: '获取附件失败' });
  }
});

/**
 * POST /pages/:id/attachments — 挂载已有文件作为附件
 * body: { fileId }
 *
 * 上传新文件请走 /api/files/upload，再用本接口挂载（前端透明处理）。
 * 运行时复合权限：当前用户需对页面有 write 权限 + 对文件有 read 权限
 */
router.post('/pages/:id/attachments', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ success: false, message: 'fileId 必填' });

    const okPage = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!okPage) return res.status(403).json({ success: false, message: '无页面写入权限' });

    const file = await db.get(`SELECT id FROM files WHERE id = ? AND deleted_at IS NULL`, [fileId]);
    if (!file) return res.status(404).json({ success: false, message: '文件不存在' });

    const okFile = await checkPermission(req.user.id, 'file', fileId, 'read');
    if (!okFile) return res.status(403).json({ success: false, message: '无该文件读取权限' });

    await db.run(
      `INSERT OR IGNORE INTO wiki_page_attachments (page_id, file_id, created_by) VALUES (?, ?, ?)`,
      [pageId, fileId, req.user.id]
    );
    await logOperation(req.user.id, 'add_wiki_attachment', 'wiki_page', pageId, { fileId }, req);
    res.json({ success: true, message: '附件已挂载' });
  } catch (error) {
    console.error('挂载附件失败:', error);
    res.status(500).json({ success: false, message: '挂载附件失败' });
  }
});

/** DELETE /pages/:id/attachments/:fileId */
router.delete('/pages/:id/attachments/:fileId', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const fileId = parseInt(req.params.fileId);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'write');
    if (!ok) return res.status(403).json({ success: false, message: '无操作权限' });
    await db.run(`DELETE FROM wiki_page_attachments WHERE page_id = ? AND file_id = ?`, [pageId, fileId]);
    await logOperation(req.user.id, 'remove_wiki_attachment', 'wiki_page', pageId, { fileId }, req);
    res.json({ success: true, message: '附件已移除（文件库源文件保留）' });
  } catch (error) {
    console.error('移除附件失败:', error);
    res.status(500).json({ success: false, message: '移除附件失败' });
  }
});

// ==================== F8 标签 + F9 收藏 + F10 浏览统计 ====================

/** GET /tags — 标签列表（带使用次数） */
router.get('/tags', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT t.id, t.name, t.color, COUNT(pt.page_id) AS usage_count
       FROM wiki_tags t LEFT JOIN wiki_page_tags pt ON t.id = pt.tag_id
       GROUP BY t.id ORDER BY usage_count DESC, t.name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取标签失败:', error);
    res.status(500).json({ success: false, message: '获取标签失败' });
  }
});

/** GET /tags/:id/pages — 按标签查页面 */
router.get('/tags/:id/pages', authenticate, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id);
    const rows = await db.query(
      `SELECT p.id, p.title, p.slug, p.space_id, p.updated_at, s.name AS space_name
       FROM wiki_page_tags pt
       INNER JOIN wiki_pages p ON pt.page_id = p.id
       LEFT JOIN spaces s ON p.space_id = s.id
       WHERE pt.tag_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.status = 'published'
       ORDER BY p.updated_at DESC`,
      [tagId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取标签页面失败:', error);
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

/** POST /pages/:id/favorite — 收藏切换 */
router.post('/pages/:id/favorite', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const exist = await db.get(
      `SELECT 1 FROM wiki_favorites WHERE user_id = ? AND page_id = ?`,
      [req.user.id, pageId]
    );
    if (exist) {
      await db.run(`DELETE FROM wiki_favorites WHERE user_id = ? AND page_id = ?`, [req.user.id, pageId]);
      res.json({ success: true, data: { favorited: false } });
    } else {
      await db.run(`INSERT INTO wiki_favorites (user_id, page_id) VALUES (?, ?)`, [req.user.id, pageId]);
      await logOperation(req.user.id, 'favorite_wiki_page', 'wiki_page', pageId, {}, req);
      res.json({ success: true, data: { favorited: true } });
    }
  } catch (error) {
    console.error('收藏失败:', error);
    res.status(500).json({ success: false, message: '收藏失败' });
  }
});

/** GET /favorites */
router.get('/favorites', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT p.id, p.title, p.slug, p.space_id, p.updated_at, s.name AS space_name, f.created_at AS favorited_at
       FROM wiki_favorites f
       INNER JOIN wiki_pages p ON f.page_id = p.id
       LEFT JOIN spaces s ON p.space_id = s.id
       WHERE f.user_id = ? AND p.deleted_at IS NULL
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取收藏失败:', error);
    res.status(500).json({ success: false, message: '获取收藏失败' });
  }
});

/** POST /pages/:id/view — 记录浏览（5 分钟去抖） */
router.post('/pages/:id/view', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const recent = await db.get(
      `SELECT 1 FROM wiki_page_views WHERE user_id = ? AND page_id = ?
       AND viewed_at > datetime('now', '-5 minutes')`,
      [req.user.id, pageId]
    );
    if (recent) return res.json({ success: true, data: { counted: false } });

    await db.run(
      `INSERT INTO wiki_page_views (page_id, user_id, ip) VALUES (?, ?, ?)`,
      [pageId, req.user.id, req.ip || null]
    );
    await db.run(`UPDATE wiki_pages SET view_count = view_count + 1 WHERE id = ?`, [pageId]);
    res.json({ success: true, data: { counted: true } });
  } catch (error) {
    console.error('记录浏览失败:', error);
    res.status(500).json({ success: false, message: '记录浏览失败' });
  }
});

/** GET /popular — 近 30 天热门 */
router.get('/popular', authenticate, async (req, res) => {
  try {
    const spaceId = req.query.spaceId ? parseInt(req.query.spaceId) : null;
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    let sql = `SELECT p.id, p.title, p.slug, p.space_id, s.name AS space_name,
        (SELECT COUNT(*) FROM wiki_page_views v WHERE v.page_id = p.id AND v.viewed_at > datetime('now','-30 days')) AS recent_views
      FROM wiki_pages p LEFT JOIN spaces s ON p.space_id = s.id
      WHERE p.deleted_at IS NULL AND p.archived_at IS NULL AND p.status = 'published'`;
    const params = [];
    if (spaceId) { sql += ` AND p.space_id = ?`; params.push(spaceId); }
    sql += ` ORDER BY recent_views DESC, p.view_count DESC LIMIT ?`;
    params.push(limit);
    const rows = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取热门失败:', error);
    res.status(500).json({ success: false, message: '获取热门失败' });
  }
});

/** GET /recent — 我的最近浏览（去重 20 条） */
router.get('/recent', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT p.id, p.title, p.slug, p.space_id, s.name AS space_name, MAX(v.viewed_at) AS last_viewed
       FROM wiki_page_views v
       INNER JOIN wiki_pages p ON v.page_id = p.id
       LEFT JOIN spaces s ON p.space_id = s.id
       WHERE v.user_id = ? AND p.deleted_at IS NULL
       GROUP BY p.id ORDER BY last_viewed DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取最近浏览失败:', error);
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// ==================== F20 订阅 ====================

/** GET /subscriptions */
router.get('/subscriptions', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT * FROM wiki_subscriptions WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取订阅失败:', error);
    res.status(500).json({ success: false, message: '获取订阅失败' });
  }
});

router.post('/subscriptions', authenticate, async (req, res) => {
  try {
    const { targetType, targetId } = req.body;
    if (!['page', 'space', 'tag'].includes(targetType) || !targetId) {
      return res.status(400).json({ success: false, message: '参数无效' });
    }
    const ins = await db.run(
      `INSERT OR IGNORE INTO wiki_subscriptions (user_id, target_type, target_id) VALUES (?, ?, ?)`,
      [req.user.id, targetType, targetId]
    );
    res.json({ success: true, data: { subscriptionId: ins.lastID } });
  } catch (error) {
    console.error('订阅失败:', error);
    res.status(500).json({ success: false, message: '订阅失败' });
  }
});

router.delete('/subscriptions/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.run(`DELETE FROM wiki_subscriptions WHERE id = ? AND user_id = ?`, [id, req.user.id]);
    res.json({ success: true, message: '已取消订阅' });
  } catch (error) {
    console.error('取消订阅失败:', error);
    res.status(500).json({ success: false, message: '取消订阅失败' });
  }
});

// ==================== F21 贡献者列表 ====================

router.get('/pages/:id/contributors', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const rows = await db.query(
      `SELECT u.id, u.username, u.real_name, u.avatar,
         COUNT(v.id) AS edit_count, MAX(v.created_at) AS last_edit_at
       FROM wiki_page_versions v INNER JOIN users u ON v.created_by = u.id
       WHERE v.page_id = ? GROUP BY u.id ORDER BY edit_count DESC, last_edit_at DESC`,
      [pageId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取贡献者失败:', error);
    res.status(500).json({ success: false, message: '获取贡献者失败' });
  }
});

router.get('/spaces/:id/contributors', authenticate, async (req, res) => {
  try {
    const spaceId = parseInt(req.params.id);
    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });
    if (!(await canReadWikiSpace(req.user, space))) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }
    const rows = await db.query(
      `SELECT u.id, u.username, u.real_name, u.avatar, COUNT(v.id) AS edit_count
       FROM wiki_page_versions v
       INNER JOIN wiki_pages p ON v.page_id = p.id
       INNER JOIN users u ON v.created_by = u.id
       WHERE p.space_id = ? AND p.deleted_at IS NULL
       GROUP BY u.id ORDER BY edit_count DESC LIMIT 50`,
      [spaceId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取贡献者失败:', error);
    res.status(500).json({ success: false, message: '获取贡献者失败' });
  }
});

// ==================== F25 批量操作 ====================

router.post('/pages/batch', authenticate, async (req, res) => {
  try {
    const { action, pageIds, payload = {} } = req.body;
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ success: false, message: 'pageIds 必填' });
    }
    const validActions = ['archive', 'unarchive', 'delete', 'restore', 'move', 'tag', 'untag'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ success: false, message: 'action 无效' });
    }

    const results = [];
    await db.transaction(async () => {
      for (const pid of pageIds) {
        const page = await db.get(`SELECT * FROM wiki_pages WHERE id = ?`, [pid]);
        if (!page) { results.push({ id: pid, ok: false, error: '页面不存在' }); continue; }
        const needPerm = (action === 'delete' || action === 'restore') ? 'delete' : 'write';
        const ok = await checkPermission(req.user.id, 'wiki_page', pid, needPerm);
        if (!ok) { results.push({ id: pid, ok: false, error: '无权限' }); continue; }

        if (action === 'archive') {
          await db.run(`UPDATE wiki_pages SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [pid]);
        } else if (action === 'unarchive') {
          await db.run(`UPDATE wiki_pages SET archived_at = NULL WHERE id = ?`, [pid]);
        } else if (action === 'delete') {
          await db.run(`UPDATE wiki_pages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [pid]);
        } else if (action === 'restore') {
          await db.run(`UPDATE wiki_pages SET deleted_at = NULL WHERE id = ?`, [pid]);
        } else if (action === 'move') {
          await db.run(`UPDATE wiki_pages SET parent_id = ? WHERE id = ?`, [payload.parentId || null, pid]);
        } else if (action === 'tag' && Array.isArray(payload.tags)) {
          for (const tName of payload.tags) {
            let tagRow = await db.get(`SELECT id FROM wiki_tags WHERE name = ?`, [tName]);
            if (!tagRow) {
              const tIns = await db.run(`INSERT INTO wiki_tags (name) VALUES (?)`, [tName]);
              tagRow = { id: tIns.lastID };
            }
            await db.run(`INSERT OR IGNORE INTO wiki_page_tags (page_id, tag_id) VALUES (?, ?)`, [pid, tagRow.id]);
          }
        } else if (action === 'untag' && Array.isArray(payload.tags)) {
          for (const tName of payload.tags) {
            const tagRow = await db.get(`SELECT id FROM wiki_tags WHERE name = ?`, [tName]);
            if (tagRow) await db.run(`DELETE FROM wiki_page_tags WHERE page_id = ? AND tag_id = ?`, [pid, tagRow.id]);
          }
        }
        results.push({ id: pid, ok: true });
      }
    });

    await logOperation(req.user.id, 'batch_wiki_pages', 'wiki_page', null, {
      action, pageIds, count: results.filter(r => r.ok).length
    }, req);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('批量操作失败:', error);
    res.status(500).json({ success: false, message: '批量操作失败' });
  }
});

// ==================== F19 PDF / Markdown 导出 ====================

const { exportPageMarkdown, exportPagePdf, exportSpaceZip, exportSpacePdf } = require('../utils/wiki-export');

// ==================== 异步导出任务（F11 / F19）====================
// 内存 Map 持久化（与 PRD 一致；服务器重启会丢失任务记录）
// 任务结构：{ id, spaceId, userId, status: 'pending'|'running'|'done'|'failed', progress, buffer, error, filename, createdAt, finishedAt }
const exportTasks = new Map();
let exportTaskSeq = 0;
function newTaskId() { return `et-${Date.now()}-${++exportTaskSeq}`; }
// 保留最近 50 个任务，旧的清理（避免内存膨胀）
function gcExportTasks() {
  if (exportTasks.size <= 50) return;
  const arr = [...exportTasks.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  while (exportTasks.size > 50) {
    const [k] = arr.shift();
    exportTasks.delete(k);
  }
}

/** GET /pages/:id/export?format=md|pdf */
router.get('/pages/:id/export', authenticate, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id);
    const ok = await checkPermission(req.user.id, 'wiki_page', pageId, 'read');
    if (!ok) return res.status(403).json({ success: false, message: '无访问权限' });

    const page = await db.get(
      `SELECT p.*, GROUP_CONCAT(t.name) AS tag_names
       FROM wiki_pages p
       LEFT JOIN wiki_page_tags pt ON p.id = pt.page_id
       LEFT JOIN wiki_tags t ON pt.tag_id = t.id
       WHERE p.id = ? AND p.deleted_at IS NULL GROUP BY p.id`,
      [pageId]
    );
    if (!page) return res.status(404).json({ success: false, message: '页面不存在' });

    const format = (req.query.format || 'md').toString();
    if (format === 'md') {
      const md = exportPageMarkdown(page);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(page.slug)}.md"`);
      return res.send(md);
    } else if (format === 'pdf') {
      const buf = await exportPagePdf(page);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(page.slug)}.pdf"`);
      return res.send(buf);
    }
    res.status(400).json({ success: false, message: 'format 必须是 md 或 pdf' });
  } catch (error) {
    console.error('导出页面失败:', error);
    res.status(500).json({ success: false, message: error.message || '导出页面失败' });
  }
});

// ==================== F11 批量导入 ====================
const multer = require('multer');
const fsPromises = require('fs').promises;
const pathLib = require('path');
const { importWikiArchive } = require('../utils/wiki-import');
const importUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const { getStoragePath } = require('../utils/storage');
        const storagePath = await getStoragePath();
        const tmp = pathLib.join(storagePath, 'temp');
        await fsPromises.mkdir(tmp, { recursive: true });
        cb(null, tmp);
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const safe = `wiki-import-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, safe + pathLib.extname(file.originalname));
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

/**
 * POST /api/wiki/spaces/:id/import — 上传 zip 或 .md 批量导入
 * form: file (multipart) + overwrite=1|0
 */
router.post('/spaces/:id/import', authenticate, importUpload.single('file'), async (req, res) => {
  let zipPath;
  try {
    const spaceId = parseInt(req.params.id);
    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });

    if (!(await canContributeWikiSpace(req.user, space))) {
      return res.status(403).json({ success: false, message: '无写入权限' });
    }

    if (!req.file) return res.status(400).json({ success: false, message: '未上传文件' });
    zipPath = req.file.path;

    const overwrite = req.body.overwrite === '1' || req.body.overwrite === 'true';
    const result = await importWikiArchive({
      spaceId,
      userId: req.user.id,
      zipPath,
      originalName: req.file.originalname,
      overwrite
    });

    await logOperation(req.user.id, 'import_wiki', 'space', spaceId, {
      total: result.total, createdCount: result.createdCount, failedCount: result.failedCount
    }, req);

    res.json({ success: true, message: `导入完成：成功 ${result.createdCount} 篇，失败 ${result.failedCount} 篇`, data: result });
  } catch (error) {
    console.error('批量导入失败:', error);
    res.status(500).json({ success: false, message: error.message || '批量导入失败' });
  } finally {
    // 清理上传的临时文件
    if (zipPath) { fsPromises.unlink(zipPath).catch(() => {}); }
  }
});

// ==================== 编辑器内联图片粘贴 / 拖拽上传 ====================
// 与 wiki_page_attachments（页面附件）不同，这里是编辑器中正文插入的小图，
// 走独立轻量存储：sha256 文件名做内容去重 + 防猜测；公开 GET（同源即可访问）。
const crypto = require('crypto');
const INLINE_IMAGE_MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg'
};
const inlineImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 单图 20MB
  fileFilter: (req, file, cb) => {
    if (INLINE_IMAGE_MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('仅支持 png/jpg/gif/webp/svg'));
  }
});

/**
 * POST /api/wiki/upload-image — 编辑器粘贴/拖拽图片专用上传
 * form: image (multipart)
 * resp: { url: '/api/wiki/images/<hash>.<ext>' }
 */
router.post('/upload-image', authenticate, inlineImageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '未上传图片' });
    const ext = INLINE_IMAGE_MIME_EXT[req.file.mimetype];
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const filename = hash + ext;

    const { getStoragePath } = require('../utils/storage');
    const storagePath = await getStoragePath();
    const dir = pathLib.resolve(storagePath, 'wiki', 'images');
    await fsPromises.mkdir(dir, { recursive: true });
    const dest = pathLib.join(dir, filename);

    // 内容寻址：相同内容只存一份
    try {
      await fsPromises.access(dest);
    } catch {
      await fsPromises.writeFile(dest, req.file.buffer);
    }

    res.json({ success: true, data: { url: `/api/wiki/images/${filename}` } });
  } catch (error) {
    console.error('上传内联图片失败:', error);
    res.status(500).json({ success: false, message: error.message || '上传图片失败' });
  }
});

/**
 * GET /api/wiki/images/:filename — 公开访问（hash 文件名作防猜测保护）
 * 适合 <img src> 直链；缓存 1 年（内容寻址永不变更）。
 */
router.get('/images/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    // 严格校验：仅允许 64 位 hex hash + 已知小写扩展名，防路径遍历
    if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/.test(filename)) {
      return res.status(400).json({ success: false, message: '非法文件名' });
    }
    const { getStoragePath } = require('../utils/storage');
    const storagePath = await getStoragePath();
    const filepath = pathLib.resolve(storagePath, 'wiki', 'images', filename);
    try { await fsPromises.access(filepath); } catch {
      return res.status(404).json({ success: false, message: '图片不存在' });
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filepath);
  } catch (error) {
    console.error('获取内联图片失败:', error);
    res.status(500).json({ success: false, message: '获取图片失败' });
  }
});

/**
 * GET /spaces/:id/export?format=md|pdf
 * - md: 同步打包返回 zip
 * - pdf: 创建异步任务，立即返回 taskId，客户端轮询 /export-tasks/:id
 */
router.get('/spaces/:id/export', authenticate, async (req, res) => {
  try {
    const spaceId = parseInt(req.params.id);
    const space = await getWikiSpace(spaceId);
    if (!space) return res.status(404).json({ success: false, message: '知识库不存在' });
    if (!(await canReadWikiSpace(req.user, space))) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }

    const format = (req.query.format || 'md').toString();

    if (format === 'md') {
      const buf = await exportSpaceZip(spaceId);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(space.name)}.zip"`);
      return res.send(buf);
    }

    if (format === 'pdf') {
      const taskId = newTaskId();
      const task = {
        id: taskId,
        spaceId,
        userId: req.user.id,
        status: 'pending',
        progress: { done: 0, total: 1, phase: 'queued' },
        buffer: null,
        error: null,
        filename: `${space.name}.pdf`,
        createdAt: Date.now(),
        finishedAt: null
      };
      exportTasks.set(taskId, task);
      gcExportTasks();

      // 后台异步执行
      (async () => {
        task.status = 'running';
        try {
          const buf = await exportSpacePdf(spaceId, (p) => { task.progress = p; });
          task.buffer = buf;
          task.status = 'done';
          task.finishedAt = Date.now();
          logOperation(req.user.id, 'export_wiki_space_pdf', 'space', spaceId, {
            taskId, pages: 'multi', sizeBytes: buf.length
          }, req).catch(() => {});
        } catch (e) {
          console.error('整库 PDF 导出失败:', e);
          task.status = 'failed';
          task.error = e.message || '导出失败';
          task.finishedAt = Date.now();
        }
      })();

      return res.json({ success: true, message: 'PDF 导出任务已创建', data: { taskId } });
    }

    res.status(400).json({ success: false, message: 'format 必须是 md 或 pdf' });
  } catch (error) {
    console.error('导出知识库失败:', error);
    res.status(500).json({ success: false, message: error.message || '导出知识库失败' });
  }
});

/** GET /export-tasks/:id — 查询任务状态；status=done 时附下载链接 */
router.get('/export-tasks/:id', authenticate, async (req, res) => {
  const task = exportTasks.get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: '任务不存在或已过期' });
  if (task.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限查看该任务' });
  }
  res.json({
    success: true,
    data: {
      id: task.id,
      status: task.status,
      progress: task.progress,
      error: task.error,
      filename: task.filename,
      sizeBytes: task.buffer ? task.buffer.length : null,
      downloadUrl: task.status === 'done' ? `/api/wiki/export-tasks/${task.id}/download` : null,
      createdAt: task.createdAt,
      finishedAt: task.finishedAt
    }
  });
});

/** GET /export-tasks/:id/download — 下载已完成任务的产物 */
router.get('/export-tasks/:id/download', authenticate, async (req, res) => {
  const task = exportTasks.get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: '任务不存在或已过期' });
  if (task.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '无权限下载' });
  }
  if (task.status !== 'done' || !task.buffer) {
    return res.status(400).json({ success: false, message: `任务尚未完成（${task.status}）` });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(task.filename)}"`);
  res.send(task.buffer);
});

// ==================== 通知（前端红点） ====================

/** GET /api/wiki/notifications/unread-count — 轻量轮询 */
router.get('/notifications/unread-count', authenticate, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT COUNT(*) AS c FROM wiki_notifications WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ success: true, data: { count: row?.c || 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取通知数失败' });
  }
})

/** GET /api/wiki/notifications — 通知列表（最多 50 条） */
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const onlyUnread = req.query.unread === '1';
    const where = onlyUnread ? 'AND n.read_at IS NULL' : '';
    const rows = await db.query(
      `SELECT n.*, u.username AS actor_name, u.real_name AS actor_real_name,
         p.title AS page_title, p.slug AS page_slug, p.space_id AS page_space_id
       FROM wiki_notifications n
       LEFT JOIN users u ON n.actor_id = u.id
       LEFT JOIN wiki_pages p ON n.target_type = 'page' AND p.id = n.target_id
       WHERE n.user_id = ? ${where}
       ORDER BY n.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const data = rows.map(r => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取通知失败:', error);
    res.status(500).json({ success: false, message: '获取通知失败' });
  }
})

/** POST /api/wiki/notifications/:id/read — 标记单条已读 */
router.post('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.run(
      `UPDATE wiki_notifications SET read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND read_at IS NULL`,
      [id, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: '标记失败' });
  }
})

/** POST /api/wiki/notifications/read-all — 全部标记已读 */
router.post('/notifications/read-all', authenticate, async (req, res) => {
  try {
    await db.run(
      `UPDATE wiki_notifications SET read_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: '标记失败' });
  }
})

module.exports = router;
module.exports.__internal = { generateSlug, ensureUniqueSlug, stripMarkdown, getWikiSpace, rebuildPageLinks };
