#!/usr/bin/env node

/**
 * 升级脚本：v1.0.10 -> v1.0.11
 *
 * 更新内容：
 * 1. 工作台：移除桌面客户端下载入口；用户上传/下载排行榜文案修正。
 * 2. 分页与每页条数：工作台「最近文件」、空间详情「空间文件」「文件夹中的文件」支持分页与每页 10/50/100 条。
 * 3. 布局与滚动：主内容区为局部滚动；最近文件/空间文件列表区域高度随窗口变化，超出时局部滚动。
 * 4. 下载链接：支持复制带 token 的下载链接（1 小时有效）；复制时兼容无 clipboard API 环境。
 * 5. 文件路径解析：resolveFilePath 多候选根与按文件名搜索，支持升级后历史文件；可选 LEGACY_STORAGE_PATHS、storage_path_fallbacks。
 * 6. 下载文件名：Content-Disposition 使用 RFC 5987 filename*，确保中文等文件名正确保存。
 * 7. FilePreview 融合：docx-preview 本地 .docx 预览；内网/本地判断；文本文件预览（txt/md/json 等）；blob/iframe 清理与错误提示；前端依赖新增 docx-preview。
 * 8. 前端上传：Files 页、SpaceDetail 页普通上传改为 customRequest（FormData + api.post、300s 超时、服务端 hint/error 拼装）；大文件失败时提示使用「大文件上传」；SpaceDetail 文件夹内文件表格 total 修复。
 * 9. server/routes/files.js：与参考 files.js 融合说明，保留 resolveFilePath、setAttachmentDisposition、download-token、download_count。
 * 10. server/utils/encryption.js：明文模式流式处理改用 stream.pipeline + Transform，更稳健。
 * 11. 其他：登录 500 与正则语法修复；admin 密码重置脚本。
 *
 * 无数据库结构变更。升级方式：git pull 后执行本脚本更新版本号，在 client 目录执行 npm install（含 docx-preview），再构建前端并重启服务即可。
 */

const fs = require('fs').promises;
const path = require('path');

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const TARGET_VERSION = '1.0.11';
const FROM_VERSION = '1.0.10';

function log(message, color = 'reset') {
  const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m' };
  console.log(`${colors[color] || ''}${message}${colors.reset}`);
}

async function getCurrentVersion(projectRoot) {
  const versionFile = getVersionFilePath(projectRoot);
  const content = await fs.readFile(versionFile, 'utf8');
  const versionInfo = JSON.parse(content);
  return versionInfo.currentVersion;
}

async function updateVersion(projectRoot) {
  const versionFile = getVersionFilePath(projectRoot);
  const content = await fs.readFile(versionFile, 'utf8');
  const versionInfo = JSON.parse(content);
  const oldVersion = versionInfo.currentVersion;

  if (oldVersion === TARGET_VERSION) {
    log(`当前版本号已为 v${TARGET_VERSION}，无需再次更新版本号。`, 'yellow');
    return 'already_target';
  }
  if (oldVersion !== FROM_VERSION) {
    log(`版本不匹配：当前 ${oldVersion}，期望 ${FROM_VERSION}。请先升级到 v${FROM_VERSION}。`, 'red');
    process.exit(1);
  }

  versionInfo.currentVersion = TARGET_VERSION;
  versionInfo.upgradeHistory = versionInfo.upgradeHistory || [];
  versionInfo.upgradeHistory.push({
    version: TARGET_VERSION,
    date: new Date().toISOString().split('T')[0],
    description: '从 1.0.10 升级到 1.0.11 - 工作台/空间分页与局部滚动、下载链接 token、路径 fallback、下载文件名 RFC5987、复制兼容；FilePreview docx/文本预览、上传 customRequest、files/encryption 融合'
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  log(`版本已更新: ${oldVersion} -> ${TARGET_VERSION}`, 'green');
  return 'updated';
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 升级脚本 v1.0.10 -> v1.0.11', 'blue');
  log('  分页、局部滚动、下载链接与文件名', 'blue');
  log('========================================\n', 'blue');

  const projectRoot = path.resolve(__dirname, '..');
  const result = await updateVersion(projectRoot);

  log('\n本次更新：', 'yellow');
  log('1. 工作台移除桌面客户端下载；最近文件/空间文件分页与每页 10/50/100');
  log('2. 内容区局部滚动，列表高度随窗口变化');
  log('3. 复制下载链接支持 token，无 clipboard 时降级复制');
  log('4. 文件路径多候选根与历史 fallback；下载文件名 RFC5987');
  log('5. FilePreview：.docx 本地预览、内网判断、文本预览；Files/SpaceDetail 上传 customRequest');
  log('6. server files.js / encryption.js 与参考实现融合');

  if (result === 'already_target') {
    log('\n说明：当前升级前运行中的系统为 v1.0.10。若 version.json 已为 v1.0.11（例如拉取新代码后），仅表示版本号无需再次写入；仍请完成代码拉取、前端安装与构建、重启服务。', 'yellow');
    log('\n若尚未完成代码拉取与前端构建，请按以下步骤操作：', 'yellow');
  }
  log('\n请先执行 git pull 拉取最新代码，在 client 目录执行 npm install（含 docx-preview），再执行 npm run client:build 构建前端，最后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
