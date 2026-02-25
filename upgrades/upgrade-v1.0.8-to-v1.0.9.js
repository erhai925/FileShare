#!/usr/bin/env node

/**
 * 升级脚本：v1.0.8 -> v1.0.9
 *
 * 更新内容：
 * 1. 时区统一为东八区北京时间：服务端强制 TZ=Asia/Shanghai；操作日志存 UTC，与库内其他表一致；前端将无时区日期按 UTC 解析后按东八区展示。
 * 2. 普通上传「上传到」文案优化：明确「上传到（普通上传与大文件上传均生效）」及选择空间为有权限的空间。
 *
 * 无数据库结构变更，无覆盖 client/server。升级方式：git pull 拉取代码后执行本脚本更新版本号，重启服务即可。
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const TARGET_VERSION = '1.0.9';
const FROM_VERSION = '1.0.8';

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
    description: '从 1.0.8 升级到 1.0.9 - 时区统一东八区北京时间、普通上传「上传到」文案优化'
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  log(`版本已更新: ${oldVersion} -> ${TARGET_VERSION}`, 'green');
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 升级脚本 v1.0.8 -> v1.0.9', 'blue');
  log('  时区东八区、上传文案优化', 'blue');
  log('========================================\n', 'blue');

  const projectRoot = path.resolve(__dirname, '..');
  await updateVersion(projectRoot);

  log('\n本次更新：', 'yellow');
  log('1. 时区：服务端强制 TZ=Asia/Shanghai；操作日志存 UTC；前端按东八区展示');
  log('2. 上传：「上传到」文案明确普通上传与大文件上传均支持指定有权限的空间');
  log('\n请执行 git pull 拉取最新代码后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
