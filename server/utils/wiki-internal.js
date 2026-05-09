/**
 * Wiki 模块共享工具函数（避免 routes/wiki.js 与 utils/wiki-* 互相依赖）
 */

const db = require('../config/database');

/** 由标题生成知识库内唯一的 slug */
function generateSlug(title, fallbackId) {
  if (!title) return `page-${fallbackId || Date.now()}`;
  let s = String(title).trim()
    .replace(/[\s\/\\?#&=+%]+/g, '-')
    .replace(/[^一-龥a-zA-Z0-9\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = `page-${fallbackId || Date.now()}`;
  if (s.length > 80) s = s.slice(0, 80);
  return s.toLowerCase();
}

/** 在 space 内确保 slug 唯一：冲突时追加 -2 / -3 ... */
async function ensureUniqueSlug(spaceId, baseSlug, excludeId = null) {
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const row = await db.get(
      `SELECT id FROM wiki_pages WHERE space_id = ? AND slug = ?${excludeId ? ' AND id != ?' : ''}`,
      excludeId ? [spaceId, slug, excludeId] : [spaceId, slug]
    );
    if (!row) return slug;
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
}

/** 去 Markdown 标记得到纯文本 */
function stripMarkdown(md) {
  if (!md) return '';
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+]+\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { generateSlug, ensureUniqueSlug, stripMarkdown };
