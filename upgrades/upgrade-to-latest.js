#!/usr/bin/env node

/**
 * 升级到最新版本（强制覆盖）
 *
 * 不校验当前版本号：无论当前是何种版本，都会将 upgrades/version.json 的 currentVersion 设为最新版本并写入。
 * 若升级历史中尚无最新版本记录，会追加一条。适用于“重新覆盖升级一次”或从任意版本直接标为最新。
 *
 * 当前最新版本：v1.0.11
 * 使用方式：npm run upgrade:latest [更新路径]
 * 或：node upgrades/upgrade-to-latest.js [更新路径]
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const LATEST_VERSION = '1.0.11';
const LATEST_DESCRIPTION = '工作台移除桌面客户端下载；最近文件/空间文件分页与每页10/50/100；内容区局部滚动与随窗口变化；下载链接 token 与复制兼容；文件路径解析与历史 fallback；下载文件名 RFC5987；FilePreview docx/文本预览与内网判断；Files/SpaceDetail 上传 customRequest；server files 与 encryption 融合参考实现';

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
  const versionFile = getVersionFilePath(projectRoot);
  let versionInfo;
  try {
    const content = await fs.readFile(versionFile, 'utf8');
    versionInfo = JSON.parse(content);
  } catch (e) {
    throw new Error(`读取或解析 version.json 失败: ${e.message}`);
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

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
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
  } else {
    const defaultHint = defaultProjectRoot;
    const inputPath = await ask(`请输入更新路径（项目根目录，将在此路径的 upgrades/version.json 写入最新版本）\n[直接回车使用默认: ${defaultHint}]: `);
    projectRoot = inputPath.trim() ? path.resolve(inputPath.trim()) : defaultProjectRoot;
  }
  if (!argPath && !process.stdin.isTTY && projectRoot === defaultProjectRoot) {
    log(`未检测到交互终端且未传入路径参数，使用默认更新路径: ${projectRoot}`, 'yellow');
    log(`若需指定其他路径，请使用: npm run upgrade:latest -- /您的部署根目录\n`, 'yellow');
  }

  const versionFile = getVersionFilePath(projectRoot);
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
  log('1. 工作台移除桌面客户端下载；最近文件/空间文件分页与每页 10/50/100');
  log('2. 内容区局部滚动，列表高度随窗口变化');
  log('3. 复制下载链接支持 token，无 clipboard 时降级复制');
  log('4. 文件路径多候选根与历史 fallback；下载文件名 RFC5987');
  log('5. FilePreview：.docx 本地预览、内网判断、文本预览；Files/SpaceDetail 上传 customRequest');
  log('6. server files.js / encryption.js 与参考实现融合');
  log('\n请在该更新路径下执行 git pull 拉取最新代码，在 client 目录执行 npm install（含 docx-preview），再执行 npm run client:build 构建前端，最后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
