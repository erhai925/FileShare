#!/usr/bin/env node

/**
 * 升级脚本：v1.0.12 -> v1.0.13
 *
 * 更新内容：
 * 1. [P0] 修复权限设置接口 INSERT 缺少 permission_type 字段，导致所有权限记录 permission_type 为 NULL
 * 2. [P0] 修复管理后台文件统计中 deleted 计数永远为 0（WHERE 条件矛盾）
 * 3. [P1] 外部分享验证通过后颁发 JWT 临时访问令牌（2h 有效期），补齐鉴权闭环
 * 4. [P1] 回收站清理补全关联数据删除（permissions/comments/external_shares/chunk_uploads）
 * 5. [P1] 清理过期版本时排除每个文件的最新版本，防止误删当前版本
 * 6. [P1] 文件下载改为流式传输（明文/AES-256），避免大文件全量读入内存 OOM
 * 7. [P2] 注册接口增加独立限流（10次/小时）及密码长度校验（≥6位）
 * 8. [P2] revoke-all-permissions 与用户删除操作使用 db.transaction() 保证原子性
 * 9. [P2] 清理 server/routes/files.js 与 client/src/services/api.ts 中约 50 行调试日志
 * 10. [P3] 下载 token 改为定期批量清理（setInterval 10 分钟），避免 setTimeout 泄漏
 * 11. [P3] 移除冗余 getStoragePathAsync 包装函数
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
const TARGET_VERSION = '1.0.13';
const FROM_VERSION = '1.0.12';

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
    description: '从 1.0.12 升级到 1.0.13 - 权限写入修复、文件统计修复、外部分享鉴权、回收站清理补全、流式下载、注册限流、事务保护、调试日志清理'
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  log(`版本已更新: ${oldVersion} -> ${TARGET_VERSION}`, 'green');
  return 'updated';
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 升级脚本 v1.0.12 -> v1.0.13', 'blue');
  log('  安全修复、性能优化、代码质量提升', 'blue');
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

  if (result === 'already_target') {
    log('\n说明：若 version.json 已为 v1.0.13，仅表示版本号无需再次写入；仍请完成代码拉取、前端构建、重启服务。', 'yellow');
    log('\n若尚未完成代码拉取与前端构建，请按以下步骤操作：', 'yellow');
  }
  log('\n请先执行 git pull 拉取最新代码，在 client 目录执行 npm install，再执行 npm run client:build 构建前端，最后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
