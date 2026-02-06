#!/usr/bin/env node

/**
 * 升级脚本：v1.0.4 -> v1.0.5
 *
 * 更新内容：
 * 1. 限流优化：信任代理（Nginx 下正确识别客户端 IP）、上传接口排除限流
 * 2. 限流说明：限流仅返回 429，绝不修改用户密码或凭证
 * 3. 大文件上传：无 Nginx 时支持 UPLOAD_TIMEOUT_MS 延长 Node 请求超时（默认 10 分钟）
 * 4. 前端 429 处理：限流时不触发登出，仅提示「请求过于频繁，请 15 分钟后再试」
 * 5. 文档：操作频繁与密码误解说明、无 Nginx 部署排查、UPLOAD_TIMEOUT_MS 配置
 *
 * 无数据库结构变更。
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const TARGET_VERSION = '1.0.5';
const FROM_VERSION = '1.0.4';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[步骤 ${step}] ${message}`, 'blue');
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function logInfo(message) {
  log(`  ${message}`, 'cyan');
}

function question(prompt, defaultValue = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const defaultHint = defaultValue ? ` [默认: ${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${prompt}${defaultHint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function getCurrentVersion(projectRoot) {
  const versionFile = getVersionFilePath(projectRoot);
  const content = await fs.readFile(versionFile, 'utf8');
  const versionInfo = JSON.parse(content);
  return versionInfo.currentVersion;
}

async function updateVersion(projectRoot, newVersion) {
  const versionFile = getVersionFilePath(projectRoot);
  const content = await fs.readFile(versionFile, 'utf8');
  const versionInfo = JSON.parse(content);
  const oldVersion = versionInfo.currentVersion;

  versionInfo.currentVersion = newVersion;
  versionInfo.upgradeHistory.push({
    version: newVersion,
    date: new Date().toISOString().split('T')[0],
    description: `从 ${oldVersion} 升级到 ${newVersion} - 限流优化、大文件上传超时、429 友好提示、文档完善`
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  logSuccess(`版本已更新: ${oldVersion} -> ${newVersion} (${versionFile})`);
}

async function checkVersion(projectRoot) {
  const currentVersion = await getCurrentVersion(projectRoot);
  if (currentVersion !== FROM_VERSION) {
    logError(`版本不匹配！当前版本: ${currentVersion}, 期望版本: ${FROM_VERSION}`);
    logWarning('请确保您正在从正确的版本升级');
    process.exit(1);
  }
  logSuccess(`当前版本检查通过: ${currentVersion}`);
}

async function getDeploymentPaths() {
  logStep(0, '配置部署路径（直接回车使用默认值）');

  const projectRoot = path.resolve(__dirname, '..');
  const defaultDbPath = path.join(projectRoot, 'data', 'fileshare.db');
  const defaultBackupPath = path.join(projectRoot, 'backups');

  logInfo(`当前脚本所在项目根目录: ${projectRoot}`);
  logInfo('若部署路径与上述相同，直接回车即可');
  log('');

  const projectRootInput = await question('项目部署根目录（代码所在路径）', projectRoot);
  const resolvedProjectRoot = path.resolve(projectRootInput);

  const dbPathInput = await question('数据库文件路径 (DB_PATH)', path.join(resolvedProjectRoot, 'data', 'fileshare.db'));
  const backupPathInput = await question('备份文件存放路径', path.join(resolvedProjectRoot, 'backups'));

  return {
    projectRoot: resolvedProjectRoot,
    dbPath: path.resolve(dbPathInput),
    backupPath: path.resolve(backupPathInput)
  };
}

async function backupDatabase(paths) {
  logStep(1, '备份数据库');

  try {
    await fs.access(paths.dbPath);
  } catch {
    logWarning('数据库文件不存在，跳过备份');
    return;
  }

  await fs.mkdir(paths.backupPath, { recursive: true }).catch(() => {});
  const backupFilePath = path.join(paths.backupPath, `fileshare.db.backup.${Date.now()}`);

  await fs.copyFile(paths.dbPath, backupFilePath);
  logSuccess(`数据库已备份到: ${backupFilePath}`);
}

async function installDependencies(projectRoot) {
  logStep(2, '安装后端依赖');
  execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('后端依赖安装完成');

  logStep(3, '安装前端依赖');
  execSync('npm install', { cwd: path.join(projectRoot, 'client'), stdio: 'inherit' });
  logSuccess('前端依赖安装完成');
}

async function buildFrontend(projectRoot) {
  logStep(4, '构建前端');
  execSync('npm run client:build', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('前端构建完成');
}

async function doUpdateVersion(projectRoot) {
  logStep(5, '更新版本号');
  await updateVersion(projectRoot, TARGET_VERSION);
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 系统升级脚本', 'blue');
  log(`  从 ${FROM_VERSION} 升级到 ${TARGET_VERSION}`, 'blue');
  log('  无数据库结构变更', 'blue');
  log('========================================\n', 'blue');

  try {
    const paths = await getDeploymentPaths();
    log('');
    log('已配置路径:', 'yellow');
    logInfo(`项目根目录: ${paths.projectRoot}`);
    logInfo(`数据库路径: ${paths.dbPath}`);
    logInfo(`备份路径: ${paths.backupPath}`);
    log('');

    await checkVersion(paths.projectRoot);

    const confirm = await question('确认以上路径并继续升级？(y/n)', 'y');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      logWarning('已取消升级');
      process.exit(0);
    }

    await backupDatabase(paths);
    await installDependencies(paths.projectRoot);
    await buildFrontend(paths.projectRoot);
    await doUpdateVersion(paths.projectRoot);

    log('\n========================================', 'green');
    log('  升级完成！', 'green');
    log('========================================\n', 'green');

    log('本次更新内容:', 'yellow');
    log('1. 限流优化：上传接口排除限流，信任代理正确识别 IP');
    log('2. 限流仅返回 429，绝不修改用户密码');
    log('3. 大文件上传：无 Nginx 时可设 UPLOAD_TIMEOUT_MS=600000 延长超时');
    log('4. 429 时不再登出，仅提示「请求过于频繁，请 15 分钟后再试」');
    log('5. 文档：操作频繁与密码误解说明、无 Nginx 部署排查');
    log('');

    log('下一步操作:', 'yellow');
    log('1. 重启服务: pm2 restart all 或 pm2 restart fileshare');
    log('2. 无 Nginx 且 75MB 上传失败: 在 .env 添加 UPLOAD_TIMEOUT_MS=600000');
    log('3. 若页面仍为旧版: 浏览器强制刷新 Ctrl+Shift+R (Win) 或 Cmd+Shift+R (Mac)');
    log('');
  } catch (error) {
    logError(`\n升级失败: ${error.message}`);
    logError('请检查错误信息并重试');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logError(`未处理的错误: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
