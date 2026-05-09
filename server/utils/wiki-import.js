/**
 * Wiki 批量导入（F11）
 *
 * 接受 zip（含目录结构）或单个 .md 文件，解析后批量建页：
 * - 解析 YAML front-matter 还原 title / tags / status
 * - 按 zip 内目录结构重建页面父子关系（每级目录会创建一个对应的"目录页"，标题为目录名，内容为空）
 * - slug 冲突时由 ensureUniqueSlug 自动追加后缀
 *
 * 用法：
 *   const { importWikiArchive } = require('../utils/wiki-import');
 *   const result = await importWikiArchive({ spaceId, userId, zipPath });
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const extract = require('extract-zip');
const db = require('../config/database');
const { generateSlug, ensureUniqueSlug, stripMarkdown } = require('./wiki-internal');

const MD_EXT = /\.md$/i;

/** 解析 YAML front-matter（极简实现，仅支持 title/slug/tags/status 这些已知字段） */
function parseFrontMatter(text) {
  if (!text) return { meta: {}, body: '' };
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const k = kv[1].trim();
    let v = kv[2].trim();
    // 解析 JSON 数组（tags: [...]）
    if (v.startsWith('[') && v.endsWith(']')) {
      try {
        meta[k] = JSON.parse(v);
        continue;
      } catch (_) {}
    }
    // 去除 "..." / '...'
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[k] = v;
  }
  return { meta, body: m[2] };
}

/** 递归扫描目录，返回 .md 文件相对路径数组 */
async function walkMarkdown(rootDir, current = '', out = []) {
  const dir = path.join(rootDir, current);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name.startsWith('__MACOSX')) continue;
    const rel = current ? path.join(current, ent.name) : ent.name;
    if (ent.isDirectory()) {
      await walkMarkdown(rootDir, rel, out);
    } else if (MD_EXT.test(ent.name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 主入口：导入 zip 或单个 md
 * @param {object} opts
 * @param {number} opts.spaceId - 知识库 ID
 * @param {number} opts.userId - 操作人
 * @param {string} opts.zipPath - 上传文件落地路径（multer 写入临时目录）
 * @param {string} opts.originalName - 原始文件名
 * @param {boolean} [opts.overwrite=false] - slug 冲突时是否覆盖（默认追加后缀新建）
 */
async function importWikiArchive({ spaceId, userId, zipPath, originalName, overwrite = false }) {
  const isZip = /\.zip$/i.test(originalName || zipPath);
  const tmpDir = path.join(os.tmpdir(), `wiki-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  let mdFiles = [];
  try {
    if (isZip) {
      await extract(zipPath, { dir: tmpDir });
      mdFiles = await walkMarkdown(tmpDir);
    } else {
      // 单个 md 直接复制到 tmpDir
      const target = path.join(tmpDir, path.basename(originalName || zipPath));
      await fs.copyFile(zipPath, target);
      mdFiles = [path.basename(target)];
    }

    if (mdFiles.length === 0) {
      throw new Error('未找到任何 .md 文件');
    }

    // 第一遍：为目录创建"占位页"以建立父子关系
    // dirPath -> pageId
    const dirPageMap = new Map();
    dirPageMap.set('', null); // 根

    /** 确保某目录路径在 wiki_pages 中有对应"目录占位页"，返回该 pageId（根目录为 null） */
    async function ensureDirPage(dirPath) {
      if (dirPath === '' || dirPath === '.') return null;
      if (dirPageMap.has(dirPath)) return dirPageMap.get(dirPath);
      const parent = path.dirname(dirPath);
      const parentId = await ensureDirPage(parent === '.' ? '' : parent);
      const baseName = path.basename(dirPath);
      const baseSlug = generateSlug(baseName);
      const slug = await ensureUniqueSlug(spaceId, baseSlug);
      const ins = await db.run(
        `INSERT INTO wiki_pages (space_id, parent_id, title, slug, content, content_text,
            status, template, sort_order, version, created_by, updated_by)
         VALUES (?, ?, ?, ?, '', '', 'published', 'blank', 0, 1, ?, ?)`,
        [spaceId, parentId, baseName, slug, userId, userId]
      );
      dirPageMap.set(dirPath, ins.lastID);
      return ins.lastID;
    }

    // 第二遍：处理每个 md 文件
    const created = [];
    const failed = [];
    for (const rel of mdFiles) {
      try {
        const abs = path.join(tmpDir, rel);
        const text = await fs.readFile(abs, 'utf8');
        const { meta, body } = parseFrontMatter(text);
        const fileName = path.basename(rel, '.md');
        const dirPath = path.dirname(rel);
        const parentId = await ensureDirPage(dirPath === '.' ? '' : dirPath);

        const title = meta.title || fileName;
        const tagsArr = Array.isArray(meta.tags) ? meta.tags : [];
        const status = meta.status === 'draft' ? 'draft' : 'published';

        let pageId;
        const baseSlug = meta.slug ? meta.slug : generateSlug(title);

        if (overwrite) {
          // 同 slug 直接覆盖（更新 content + 写新版本）
          const existing = await db.get(
            `SELECT id, version FROM wiki_pages WHERE space_id = ? AND slug = ? AND deleted_at IS NULL`,
            [spaceId, baseSlug]
          );
          if (existing) {
            const newVersion = existing.version + 1;
            const contentText = stripMarkdown(body);
            await db.run(
              `UPDATE wiki_pages SET title = ?, content = ?, content_text = ?, version = ?,
                  status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [title, body, contentText, newVersion, status, userId, existing.id]
            );
            await db.run(
              `INSERT INTO wiki_page_versions (page_id, version, title, content, change_note, created_by)
               VALUES (?, ?, ?, ?, '导入覆盖', ?)`,
              [existing.id, newVersion, title, body, userId]
            );
            pageId = existing.id;
          }
        }
        if (!pageId) {
          const slug = await ensureUniqueSlug(spaceId, baseSlug);
          const contentText = stripMarkdown(body);
          const ins = await db.run(
            `INSERT INTO wiki_pages (space_id, parent_id, title, slug, content, content_text,
                status, template, sort_order, version, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'blank', 0, 1, ?, ?)`,
            [spaceId, parentId, title, slug, body, contentText, status, userId, userId]
          );
          pageId = ins.lastID;
          if (status === 'published') {
            await db.run(
              `INSERT INTO wiki_page_versions (page_id, version, title, content, change_note, created_by)
               VALUES (?, 1, ?, ?, '导入', ?)`,
              [pageId, title, body, userId]
            );
          }
        }

        // 标签
        for (const t of tagsArr) {
          if (!t || typeof t !== 'string') continue;
          let tagRow = await db.get(`SELECT id FROM wiki_tags WHERE name = ?`, [t.trim()]);
          if (!tagRow) {
            const tIns = await db.run(`INSERT INTO wiki_tags (name) VALUES (?)`, [t.trim()]);
            tagRow = { id: tIns.lastID };
          }
          await db.run(
            `INSERT OR IGNORE INTO wiki_page_tags (page_id, tag_id) VALUES (?, ?)`,
            [pageId, tagRow.id]
          );
        }
        created.push({ pageId, title, path: rel });
      } catch (e) {
        failed.push({ path: rel, error: e.message });
      }
    }

    return {
      total: mdFiles.length,
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed
    };
  } finally {
    // 清理临时目录
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { importWikiArchive, parseFrontMatter };
