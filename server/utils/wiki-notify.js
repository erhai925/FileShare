/**
 * Wiki 通知（前端红点专用）
 *
 * 决策：仅写 wiki_notifications 表，不外发邮件/站内信。
 * 前端通过 GET /api/wiki/notifications 拉取。
 *
 * 触发点：
 * 1. notifyMention(actorId, pageId, mentionedIds, payload) — 评论中 @ 提及他人
 * 2. notifyPageSubscribers(actorId, pageId, action) — 编辑/发布订阅页面
 * 3. notifySpaceSubscribers(actorId, spaceId, pageId, action) — 在订阅的知识库下创建/发布页面
 * 4. notifyTagSubscribers(actorId, tagIds, pageId, action) — 在订阅的标签下创建/发布页面
 *
 * 全部最佳努力（best-effort）：插入失败不阻塞业务路径。
 */

const db = require('../config/database');

async function safeInsert(userId, type, targetType, targetId, actorId, payload) {
  if (!userId || userId === actorId) return; // 不通知自己
  try {
    await db.run(
      `INSERT INTO wiki_notifications (user_id, type, target_type, target_id, actor_id, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, type, targetType, targetId, actorId || null, payload ? JSON.stringify(payload) : null]
    );
  } catch (e) {
    console.error('[wiki-notify] 写入失败:', e.message);
  }
}

/** @ 提及通知 */
async function notifyMention(actorId, pageId, mentionedIds, payload = {}) {
  if (!Array.isArray(mentionedIds) || mentionedIds.length === 0) return;
  for (const uid of mentionedIds) {
    await safeInsert(uid, 'mention', 'page', pageId, actorId, payload);
  }
}

/** 页面订阅者通知 */
async function notifyPageSubscribers(actorId, pageId, payload = {}) {
  try {
    const subs = await db.query(
      `SELECT user_id FROM wiki_subscriptions WHERE target_type = 'page' AND target_id = ?`,
      [pageId]
    );
    for (const s of subs) {
      await safeInsert(s.user_id, 'subscription_update', 'page', pageId, actorId, payload);
    }
  } catch (e) {
    console.error('[wiki-notify] page subscribers:', e.message);
  }
}

/** 知识库订阅者通知 */
async function notifySpaceSubscribers(actorId, spaceId, pageId, payload = {}) {
  try {
    const subs = await db.query(
      `SELECT user_id FROM wiki_subscriptions WHERE target_type = 'space' AND target_id = ?`,
      [spaceId]
    );
    for (const s of subs) {
      await safeInsert(s.user_id, 'subscription_update', 'page', pageId, actorId, payload);
    }
  } catch (e) {
    console.error('[wiki-notify] space subscribers:', e.message);
  }
}

/** 标签订阅者通知 — tagIds 是该页面新打的所有标签 id */
async function notifyTagSubscribers(actorId, tagIds, pageId, payload = {}) {
  if (!tagIds || tagIds.length === 0) return;
  try {
    const ph = tagIds.map(() => '?').join(',');
    const subs = await db.query(
      `SELECT DISTINCT user_id FROM wiki_subscriptions
        WHERE target_type = 'tag' AND target_id IN (${ph})`,
      tagIds
    );
    for (const s of subs) {
      await safeInsert(s.user_id, 'subscription_update', 'page', pageId, actorId, payload);
    }
  } catch (e) {
    console.error('[wiki-notify] tag subscribers:', e.message);
  }
}

/** 综合：发布/更新页面时一并通知页面 + 知识库 + 标签订阅者（去重） */
async function notifyAllOnPageUpdate(actorId, page, action) {
  const payload = { title: page.title, spaceId: page.space_id, action };
  // 收集所有应当通知的 user_id 一次性去重
  const recipients = new Set();
  try {
    const pageSubs = await db.query(
      `SELECT user_id FROM wiki_subscriptions WHERE target_type = 'page' AND target_id = ?`,
      [page.id]
    );
    pageSubs.forEach(s => recipients.add(s.user_id));

    const spaceSubs = await db.query(
      `SELECT user_id FROM wiki_subscriptions WHERE target_type = 'space' AND target_id = ?`,
      [page.space_id]
    );
    spaceSubs.forEach(s => recipients.add(s.user_id));

    const tagRows = await db.query(
      `SELECT DISTINCT s.user_id FROM wiki_subscriptions s
       INNER JOIN wiki_page_tags pt ON s.target_type = 'tag' AND s.target_id = pt.tag_id
       WHERE pt.page_id = ?`,
      [page.id]
    );
    tagRows.forEach(s => recipients.add(s.user_id));

    recipients.delete(actorId); // 不通知作者本人
    for (const uid of recipients) {
      await safeInsert(uid, 'subscription_update', 'page', page.id, actorId, payload);
    }
  } catch (e) {
    console.error('[wiki-notify] notifyAllOnPageUpdate:', e.message);
  }
}

module.exports = {
  notifyMention,
  notifyPageSubscribers,
  notifySpaceSubscribers,
  notifyTagSubscribers,
  notifyAllOnPageUpdate
};
