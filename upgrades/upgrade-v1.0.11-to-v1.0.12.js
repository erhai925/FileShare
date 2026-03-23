#!/usr/bin/env node

/**
 * 升级脚本：v1.0.11 -> v1.0.12
 *
 * 更新内容：
 * 1. server/utils/office-preview.js：PPT 转 PDF 失败（如未安装 LibreOffice）时不再 rethrow，避免未处理 Promise 导致进程崩溃。
 * 2. 空间详情：上传成功后 refetchFolders，文件夹树「x 个文件」数量及时更新。
 * 3. 下载前统一弹出提示（FileActions / 文件详情 / 预览）：下载的文件需要根据客户实际情况和主胶片最新版本进行更新。
 * 4. 管理后台：备份/恢复请求超时延长至 30 分钟；备份 zip 压缩 zlib level 调整为 6（平衡速度与体积）。
 * 5. 普通上传大文件提示「使用大文件上传」时，将已选文件传入 ChunkUpload（initialFile），无需在弹窗内再次选择文件。
 * 6. Files / SpaceDetail：普通上传与大文件切换相关交互优化。
 *
 * 无数据库结构变更。升级流程：运行脚本后先输入「更新路径」，脚本从该路径读取 upgrades/version.json 再执行升级；完成后 git pull、client 目录 npm install 与 npm run client:build、重启服务。
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

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
    description: '从 1.0.11 升级到 1.0.12 - office-preview 失败不崩溃、文件夹文件数刷新、下载前提示、备份超时与压缩 level6、大文件切换免重选文件'
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  log(`版本已更新: ${oldVersion} -> ${TARGET_VERSION}`, 'green');
  return 'updated';
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 升级脚本 v1.0.11 -> v1.0.12', 'blue');
  log('  稳定性、下载提示、备份与大文件上传体验', 'blue');
  log('========================================\n', 'blue');

  let projectRoot = defaultProjectRoot;
  const argPath = process.argv[2];
  if (argPath && argPath.trim()) {
    projectRoot = path.resolve(argPath.trim());
    log(`使用命令行参数作为更新路径: ${projectRoot}\n`, 'blue');
  } else {
    const defaultHint = defaultProjectRoot;
    const inputPath = await ask(`请输入更新路径（当前运行系统的项目根目录，将从此路径读取版本号并写入升级结果）\n[直接回车使用默认: ${defaultHint}]: `);
    projectRoot = inputPath.trim() ? path.resolve(inputPath.trim()) : defaultProjectRoot;
  }
  if (!argPath && !process.stdin.isTTY && projectRoot === defaultProjectRoot) {
    log(`未检测到交互终端且未传入路径参数，使用默认更新路径: ${projectRoot}`, 'yellow');
    log(`若需指定其他路径，请使用: npm run upgrade -- /您的部署根目录\n`, 'yellow');
  }

  const versionFile = getVersionFilePath(projectRoot);
  try {
    await fs.access(versionFile);
  } catch (e) {
    log(`错误：在路径 ${projectRoot} 下未找到 upgrades/version.json，请确认更新路径是否正确。`, 'red');
    process.exit(1);
  }

  const currentVersion = await getCurrentVersion(projectRoot);
  log(`\n更新路径: ${projectRoot}`, 'blue');
  log(`该路径下当前版本: v${currentVersion}\n`, 'blue');

  const result = await updateVersion(projectRoot);

  log('\n本次更新：', 'yellow');
  log('1. PPT 预览失败不导致 Node 进程崩溃');
  log('2. 上传后文件夹文件数量显示更新');
  log('3. 下载前提示（主胶片/客户实际情况）');
  log('4. 管理后台备份/恢复超时 30 分钟，备份压缩 level 6');
  log('5. 普通上传切大文件上传时自动使用已选文件');

  if (result === 'already_target') {
    log('\n说明：若 version.json 已为 v1.0.12，仅表示版本号无需再次写入；仍请完成代码拉取、前端构建、重启服务。', 'yellow');
    log('\n若尚未完成代码拉取与前端构建，请按以下步骤操作：', 'yellow');
  }
  log('\n请先执行 git pull 拉取最新代码，在 client 目录执行 npm install，再执行 npm run client:build 构建前端，最后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
