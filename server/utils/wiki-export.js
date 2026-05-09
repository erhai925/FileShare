/**
 * Wiki 导出工具
 *
 * - exportPageMarkdown: 同步生成单页 .md（含 YAML front-matter）
 * - exportSpaceZip: 异步用 archiver 打包整库（按页面树目录结构）
 * - exportPagePdf: 异步导出 PDF；懒加载 puppeteer（避免向核心依赖引入 ~250MB Chromium）
 *   未安装 puppeteer 时抛出明确错误，用户可按需 npm i puppeteer 启用
 */

const archiver = require('archiver');
const db = require('../config/database');

/** 生成单页 Markdown 字符串（含 YAML front-matter） */
function exportPageMarkdown(page) {
  const tags = page.tag_names ? String(page.tag_names).split(',').filter(Boolean) : [];
  const fm = [
    '---',
    `title: ${JSON.stringify(page.title || '')}`,
    `slug: ${page.slug || ''}`,
    `version: ${page.version || 1}`,
    `status: ${page.status || 'published'}`,
    tags.length > 0 ? `tags: [${tags.map(t => JSON.stringify(t)).join(', ')}]` : 'tags: []',
    `updated_at: ${page.updated_at || ''}`,
    '---',
    ''
  ].join('\n');
  return fm + (page.content || '');
}

/** 异步导出整个知识库为 zip（按目录树组织） */
async function exportSpaceZip(spaceId) {
  const space = await db.get(`SELECT * FROM spaces WHERE id = ?`, [spaceId]);
  if (!space) throw new Error('知识库不存在');

  const pages = await db.query(
    `SELECT p.*, GROUP_CONCAT(t.name) AS tag_names
     FROM wiki_pages p
     LEFT JOIN wiki_page_tags pt ON p.id = pt.page_id
     LEFT JOIN wiki_tags t ON pt.tag_id = t.id
     WHERE p.space_id = ? AND p.deleted_at IS NULL
     GROUP BY p.id ORDER BY p.parent_id, p.sort_order`,
    [spaceId]
  );

  // 构建 id -> page、id -> 路径
  const byId = new Map(pages.map(p => [p.id, p]));
  function pathOf(p) {
    const segs = [];
    let cur = p;
    while (cur) {
      segs.unshift(cur.slug || `page-${cur.id}`);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
    return segs.join('/');
  }

  return await new Promise((resolve, reject) => {
    const buffers = [];
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('data', d => buffers.push(d));
    archive.on('end', () => resolve(Buffer.concat(buffers)));
    archive.on('error', reject);

    // 元数据
    archive.append(JSON.stringify({
      space: { id: space.id, name: space.name, type: space.type, description: space.description },
      exported_at: new Date().toISOString(),
      page_count: pages.length
    }, null, 2), { name: '_meta.json' });

    for (const p of pages) {
      const md = exportPageMarkdown(p);
      const pth = pathOf(p);
      archive.append(md, { name: `${pth}.md` });
    }
    archive.finalize();
  });
}

const puppeteer = require('puppeteer');
const MarkdownIt = require('markdown-it');

/**
 * 导出单页 PDF（puppeteer 已纳入核心依赖）
 * 首次启动会拉取 Chromium（~250MB），离线/受限网络可用 PUPPETEER_SKIP_DOWNLOAD=1 + PUPPETEER_EXECUTABLE_PATH 指向系统 Chrome
 */
async function exportPagePdf(page) {
  const md = new MarkdownIt({ html: false, breaks: true, linkify: true });
  const html = md.render(page.content || '');

  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${page.title}</title>
    <style>
      body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 2em; line-height: 1.7; color: #222; }
      h1, h2, h3 { color: #0d9488; }
      pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow: auto; }
      code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; }
      table { border-collapse: collapse; }
      th, td { border: 1px solid #ddd; padding: 6px 10px; }
      .header { border-bottom: 2px solid #0d9488; margin-bottom: 1em; padding-bottom: .5em; }
      .meta { color: #888; font-size: 12px; }
    </style>
  </head><body>
    <div class="header">
      <h1 style="margin:0">${page.title}</h1>
      <div class="meta">版本 v${page.version} · 更新于 ${page.updated_at}</div>
    </div>
    ${html}
  </body></html>`;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const p = await browser.newPage();
    await p.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdfBuf = await p.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#888">${page.title}</div>`,
      footerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`
    });
    // puppeteer 23.x 返回 Uint8Array，需转换为 Node Buffer 否则 Express 会 JSON 化
    return Buffer.isBuffer(pdfBuf) ? pdfBuf : Buffer.from(pdfBuf);
  } finally {
    await browser.close();
  }
}

/**
 * 导出整个知识库为单个 PDF：合并所有页面 + 自动生成目录页
 * @param {number} spaceId
 * @param {(progress:{done:number,total:number,phase:string})=>void} [onProgress]
 */
async function exportSpacePdf(spaceId, onProgress) {
  const space = await db.get(`SELECT * FROM spaces WHERE id = ?`, [spaceId]);
  if (!space) throw new Error('知识库不存在');

  const pages = await db.query(
    `SELECT p.*, GROUP_CONCAT(t.name) AS tag_names
     FROM wiki_pages p
     LEFT JOIN wiki_page_tags pt ON p.id = pt.page_id
     LEFT JOIN wiki_tags t ON pt.tag_id = t.id
     WHERE p.space_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL
       AND p.status = 'published'
     GROUP BY p.id ORDER BY p.parent_id, p.sort_order, p.id`,
    [spaceId]
  );
  if (pages.length === 0) throw new Error('知识库下没有可导出的已发布页面');

  // 构建目录树用于路径与目录页
  const byId = new Map(pages.map(p => [p.id, p]));
  function depthOf(p) {
    let d = 0; let cur = p;
    while (cur && cur.parent_id && byId.has(cur.parent_id)) { d++; cur = byId.get(cur.parent_id); }
    return d;
  }

  const md = new MarkdownIt({ html: false, breaks: true, linkify: true });

  // 目录页 HTML
  const tocHtml = pages.map(p => {
    const indent = depthOf(p) * 16;
    return `<div style="padding-left:${indent}px;line-height:1.9"><a href="#page-${p.id}">${escapeHtml(p.title)}</a></div>`;
  }).join('');

  // 各页 HTML（每页前加分页符）
  const pageBlocks = pages.map((p, i) => `
    <div ${i > 0 ? 'style="page-break-before:always"' : ''}>
      <h1 id="page-${p.id}" style="border-bottom:2px solid #0d9488;padding-bottom:.4em">${escapeHtml(p.title)}</h1>
      <div style="color:#888;font-size:11px;margin-bottom:1em">
        v${p.version} · ${p.updated_at}${p.tag_names ? ' · ' + escapeHtml(p.tag_names) : ''}
      </div>
      ${md.render(p.content || '')}
    </div>
  `).join('\n');

  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(space.name)}</title>
    <style>
      body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 2em; line-height: 1.7; color: #222; }
      h1, h2, h3 { color: #0d9488; }
      pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow: auto; }
      code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 6px 10px; }
      a { color: #0d9488; text-decoration: none; }
      .cover { text-align: center; padding-top: 30vh; }
    </style>
  </head><body>
    <div class="cover">
      <h1 style="font-size:32px;border-bottom:none">${escapeHtml(space.name)}</h1>
      <div style="color:#888;margin-top:8px">${escapeHtml(space.description || '')}</div>
      <div style="color:#888;margin-top:8px">${pages.length} 篇 · 导出于 ${new Date().toLocaleString('zh-CN')}</div>
    </div>
    <div style="page-break-before:always">
      <h2>目录</h2>
      ${tocHtml}
    </div>
    ${pageBlocks}
  </body></html>`;

  if (onProgress) onProgress({ done: 0, total: 1, phase: 'rendering' });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const p = await browser.newPage();
    await p.setContent(fullHtml, { waitUntil: 'networkidle0' });
    if (onProgress) onProgress({ done: 0, total: 1, phase: 'pdf' });
    const pdfBuf = await p.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#888">${escapeHtml(space.name)}</div>`,
      footerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`
    });
    return Buffer.isBuffer(pdfBuf) ? pdfBuf : Buffer.from(pdfBuf);
  } finally {
    await browser.close();
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { exportPageMarkdown, exportPagePdf, exportSpaceZip, exportSpacePdf };
