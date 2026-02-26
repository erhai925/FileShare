#!/usr/bin/env node

/**
 * 升级脚本：v1.0.9 -> v1.0.10
 *
 * 更新内容：
 * 1. 空间内大文件上传：空间详情页（文件树、文件列表、文件夹）增加「大文件上传（断点续传）」入口。
 * 2. 下载与长耗时操作反馈：文件下载时显示「正在准备下载，请稍候…」，完成后提示成功或错误。
 * 3. 永久删除：客户端超时 2 分钟、服务端 3 分钟；先清理所有引用再删 files，修复 FOREIGN KEY 错误；清理 chunk_uploads.file_id。
 * 4. 登录与缓存：进入受保护页前校验 token（/auth/me）；index.html 增加防缓存头。
 *
 * 无数据库结构变更。升级方式：git pull 拉取代码后执行本脚本更新版本号，构建前端并重启服务即可。
 */

const fs = require('fs').promises;
const path = require('path');

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const TARGET_VERSION = '1.0.10';
const FROM_VERSION = '1.0.9';

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
    description: '从 1.0.9 升级到 1.0.10 - 空间大文件上传、下载反馈、永久删除超时与外键修复、登录校验与防缓存'
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  log(`版本已更新: ${oldVersion} -> ${TARGET_VERSION}`, 'green');
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 升级脚本 v1.0.9 -> v1.0.10', 'blue');
  log('  空间大文件上传、下载反馈、永久删除与登录校验', 'blue');
  log('========================================\n', 'blue');

  const projectRoot = path.resolve(__dirname, '..');
  await updateVersion(projectRoot);

  log('\n本次更新：', 'yellow');
  log('1. 空间页增加「大文件上传（断点续传）」入口');
  log('2. 下载时显示等待提示与完成结果');
  log('3. 永久删除：超时延长，外键顺序与 chunk_uploads 清理修复');
  log('4. 进入受保护页前校验 token；index 防缓存');
  log('\n请先执行 git pull 拉取最新代码，再执行 npm run client:build 构建前端，最后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
