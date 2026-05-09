/**
 * Wiki 回收站清理任务（F18）
 * 启动时调度，定期扫描 deleted_at 早于 retentionDays 的 wiki_pages 并彻底删除（含级联）。
 *
 * 配置：
 *   WIKI_TRASH_RETENTION_DAYS — 默认 30 天
 *
 * 使用：
 *   const { startWikiTrashCleanup } = require('./jobs/wiki-trash-cleanup');
 *   startWikiTrashCleanup();
 */

const db = require('../config/database');

const RETENTION_DAYS = parseInt(process.env.WIKI_TRASH_RETENTION_DAYS) || 30;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 每 12 小时跑一次

async function cleanupExpiredTrash() {
  try {
    const expired = await db.query(
      `SELECT id FROM wiki_pages WHERE deleted_at IS NOT NULL
        AND deleted_at < datetime('now', '-${RETENTION_DAYS} days')`
    );
    if (expired.length === 0) return 0;

    const ids = expired.map(r => r.id);
    const ph = ids.map(() => '?').join(',');

    await db.transaction(async () => {
      await db.run(`DELETE FROM wiki_page_versions WHERE page_id IN (${ph})`, ids);
      await db.run(`DELETE FROM wiki_page_views WHERE page_id IN (${ph})`, ids);
      await db.run(`DELETE FROM wiki_page_tags WHERE page_id IN (${ph})`, ids);
      await db.run(`DELETE FROM wiki_favorites WHERE page_id IN (${ph})`, ids);
      await db.run(`DELETE FROM wiki_page_links WHERE source_page_id IN (${ph}) OR target_page_id IN (${ph})`, [...ids, ...ids]);
      await db.run(`DELETE FROM wiki_page_attachments WHERE page_id IN (${ph})`, ids);
      await db.run(`DELETE FROM wiki_comments WHERE page_id IN (${ph})`, ids);
      await db.run(`DELETE FROM wiki_subscriptions WHERE target_type = 'page' AND target_id IN (${ph})`, ids);
      await db.run(`DELETE FROM permissions WHERE resource_type = 'wiki_page' AND resource_id IN (${ph})`, ids);
      await db.run(`DELETE FROM wiki_pages WHERE id IN (${ph})`, ids);
    });
    console.log(`[wiki-trash-cleanup] 已彻底删除 ${ids.length} 个 Wiki 页面（保留期 ${RETENTION_DAYS} 天）`);
    return ids.length;
  } catch (e) {
    console.error('[wiki-trash-cleanup] 清理失败:', e);
    return 0;
  }
}

let timer = null;
function startWikiTrashCleanup() {
  // 启动 60 秒后跑一次（避免与服务启动竞争），随后每 CHECK_INTERVAL_MS 重复
  setTimeout(() => {
    cleanupExpiredTrash();
    timer = setInterval(cleanupExpiredTrash, CHECK_INTERVAL_MS);
  }, 60 * 1000);
}

function stopWikiTrashCleanup() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startWikiTrashCleanup, stopWikiTrashCleanup, cleanupExpiredTrash };
