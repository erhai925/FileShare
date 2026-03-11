#!/usr/bin/env node

/**
 * 升级脚本：v1.0.11 -> v1.0.12
 *
 * 更新内容：
 * 1. FilePreview：docx-preview 本地 .docx 预览；内网/本地判断（10.x、172.16-31、192.168）；文本文件预览（txt/md/json 等）；blob/iframe 清理与错误提示。
 * 2. 前端上传：Files 页、SpaceDetail 页普通上传改为 customRequest（FormData + api.post、300s 超时、服务端 hint/error 拼装）；大文件失败时提示使用「大文件上传」。
 * 3. SpaceDetail：文件夹内文件表格 total 类型修复；移除未使用的 user 解构。
 * 4. server/routes/files.js：与参考 files.js 融合说明，保留 resolveFilePath、setAttachmentDisposition、download-token、download_count。
 * 5. server/utils/encryption.js：明文模式流式处理改用 stream.pipeline + Transform，更稳健。
 *
 * 无数据库结构变更。升级方式：git pull 后执行本脚本更新版本号，安装前端依赖（含 docx-preview）、构建前端并重启服务即可。
 */

const fs = require('fs').promises;
const path = require('path');

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const TARGET_VERSION = '1.0.12';
const FROM_VERSION = '1.0.11';

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
    log(`当前已是 v${TARGET_VERSION}，无需更新。`, 'yellow');
    return;
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
    description: '从 1.0.11 升级到 1.0.12 - FilePreview docx/文本预览、上传 customRequest、files/encryption 融合'
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  log(`版本已更新: ${oldVersion} -> ${TARGET_VERSION}`, 'green');
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 升级脚本 v1.0.11 -> v1.0.12', 'blue');
  log('  预览增强、上传 customRequest、服务端融合', 'blue');
  log('========================================\n', 'blue');

  const projectRoot = path.resolve(__dirname, '..');
  await updateVersion(projectRoot);

  log('\n本次更新：', 'yellow');
  log('1. FilePreview：.docx 本地预览、内网判断、文本预览、错误与清理');
  log('2. Files / SpaceDetail：上传改为 customRequest，超时与错误 hint');
  log('3. SpaceDetail：文件夹内文件分页 total 修复');
  log('4. server files.js / encryption.js 与参考实现融合');
  log('\n请先执行 git pull 拉取最新代码，在 client 目录执行 npm install（含 docx-preview），再执行 npm run build 构建前端，最后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
