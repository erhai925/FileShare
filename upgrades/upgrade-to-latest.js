#!/usr/bin/env node

/**
 * 升级到最新版本（强制覆盖）
 *
 * 不校验当前版本号：无论当前是何种版本，都会将 upgrades/version.json 的 currentVersion 设为最新版本并写入。
 * 若升级历史中尚无最新版本记录，会追加一条。适用于“重新覆盖升级一次”或从任意版本直接标为最新。
 *
 * 当前最新版本：v1.0.12
 * 使用方式：npm run upgrade:latest [更新路径]
 * 或：node upgrades/upgrade-to-latest.js [更新路径]
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const LATEST_VERSION = '1.0.13';
const LATEST_DESCRIPTION = '权限写入修复、文件统计修复、外部分享鉴权、回收站清理补全、流式下载、注册限流、事务保护、调试日志清理';

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const defaultProjectRoot = path.resolve(__dirname, '..');

function ask(question) {
  let input = process.stdin;
  if (!process.stdin.isTTY && process.platform !== 'win32') {
    try {
      input = require('fs').createReadStream('/dev/tty');
    } catch (e) {
      input = process.stdin;
    }
  }
  const rl = readline.createInterface({ input, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer || '');
    });
  }).finally(() => {
    if (input !== process.stdin && input.destroy) input.destroy();
  });
}

function log(message, color = 'reset') {
  const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m' };
  console.log(`${colors[color] || ''}${message}${colors.reset}`);
}

async function forceUpgradeToLatest(projectRoot) {
  const versionFile = path.resolve(getVersionFilePath(projectRoot));
  let versionInfo;
  try {
    const content = await fs.readFile(versionFile, 'utf8');
    versionInfo = JSON.parse(content);
  } catch (e) {
    throw new Error(`读取或解析 version.json 失败: ${e.message}`);
  }
  if (!versionInfo || typeof versionInfo !== 'object') {
    throw new Error('version.json 格式异常，需包含 currentVersion 或 upgradeHistory');
  }

  const oldVersion = versionInfo.currentVersion || '未知';
  versionInfo.currentVersion = LATEST_VERSION;
  versionInfo.upgradeHistory = versionInfo.upgradeHistory || [];

  const hasEntry = versionInfo.upgradeHistory.some((e) => e.version === LATEST_VERSION);
  if (!hasEntry) {
    versionInfo.upgradeHistory.push({
      version: LATEST_VERSION,
      date: new Date().toISOString().split('T')[0],
      description: LATEST_DESCRIPTION
    });
  }

  try {
    await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  } catch (e) {
    throw new Error(`写入 version.json 失败: ${e.message}`);
  }
  log(`版本已覆盖为最新: v${oldVersion} -> v${LATEST_VERSION}`, 'green');
}

async function main() {
  log('\n========================================', 'blue');
  log(`  FileShare 升级到最新版本（强制覆盖） -> v${LATEST_VERSION}`, 'blue');
  log('  不校验当前版本，直接写入最新版本号', 'blue');
  log('========================================\n', 'blue');

  let projectRoot = defaultProjectRoot;
  const argPath = process.argv[2];
  if (argPath && argPath.trim()) {
    projectRoot = path.resolve(argPath.trim());
    log(`使用命令行参数作为更新路径: ${projectRoot}\n`, 'blue');
  } else if (process.stdin.isTTY) {
    const defaultHint = defaultProjectRoot;
    const inputPath = await ask(`请输入更新路径（项目根目录，将在此路径的 upgrades/version.json 写入最新版本）\n[直接回车使用默认: ${defaultHint}]: `);
    projectRoot = inputPath.trim() ? path.resolve(inputPath.trim()) : defaultProjectRoot;
  } else {
    log(`未传入路径参数且非交互终端，使用默认更新路径: ${projectRoot}`, 'yellow');
    log(`若需指定其他路径，请使用: npm run upgrade:latest -- /您的部署根目录\n`, 'yellow');
  }

  const versionFile = path.resolve(getVersionFilePath(projectRoot));
  try {
    await fs.access(versionFile);
  } catch (e) {
    log(`错误：在路径 ${projectRoot} 下未找到 upgrades/version.json，请确认更新路径是否正确。`, 'red');
    process.exit(1);
  }

  let currentVersion = '未知';
  try {
    const content = await fs.readFile(versionFile, 'utf8');
    const info = JSON.parse(content);
    currentVersion = info.currentVersion || currentVersion;
  } catch (_) {}
  log(`更新路径: ${projectRoot}`, 'blue');
  log(`该路径下当前版本: v${currentVersion}（即将覆盖为 v${LATEST_VERSION}）\n`, 'blue');

  try {
    await forceUpgradeToLatest(projectRoot);
  } catch (e) {
    log(`升级失败: ${e.message}`, 'red');
    process.exit(1);
  }

  log('\n本次更新内容（v' + LATEST_VERSION + '）：', 'yellow');
  log('[P0] 1. 修复权限设置接口 permission_type 缺失');
  log('[P0] 2. 修复管理后台文件统计 deleted 计数永远为 0');
  log('[P1] 3. 外部分享验证后颁发临时 JWT 令牌');
  log('[P1] 4. 回收站清理补全关联数据删除');
  log('[P1] 5. 过期版本清理排除最新版本');
  log('[P1] 6. 文件下载流式传输，避免大文件 OOM');
  log('[P2] 7. 注册接口独立限流 + 密码校验');
  log('[P2] 8. 权限撤销与用户删除使用事务');
  log('[P2] 9. 清理约 50 行调试日志');
  log('[P3] 10. 下载 token 定期批量清理');
  log('[P3] 11. 移除冗余 getStoragePathAsync');
  log('\n请在该更新路径下执行 git pull 拉取最新代码，在 client 目录执行 npm install，再执行 npm run client:build 构建前端，最后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  log(`执行失败: ${err.message}`, 'red');
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
