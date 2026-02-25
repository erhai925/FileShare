#!/usr/bin/env node

/**
 * 升级脚本：v1.0.3 -> v1.0.4
 *
 * 更新内容：
 * 1. 大文件上传：请求体限制 500mb，Nginx client_max_body_size 配置说明
 * 2. PM2 前后端同时启动（ecosystem.config.js）
 * 3. 空间管理置于文件管理之上（侧边栏顺序）
 * 4. 工作台最近文件显示所在空间/文件夹，可点击进入
 * 5. 空间详情页支持 ?folderId= 直接定位文件夹
 * 6. 工作台显示当前登录者真实姓名
 * 7. 用户管理增加登录次数统计（依赖 operation_logs 表）
 *
 * 数据库迁移：执行完整 schema 同步，确保所有表、索引与当前版本一致
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const TARGET_VERSION = '1.0.4';
const FROM_VERSION = '1.0.3';

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
    description: `从 ${oldVersion} 升级到 ${newVersion} - 大文件上传、PM2前后端、工作台优化、登录次数统计等`
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

  const defaultProjectRoot = '/home/FileShare-main';
  const projectRoot = path.resolve(__dirname, '..');
  const defaultDbPath = path.join(defaultProjectRoot, 'data', 'fileshare.db');
  const defaultBackupPath = path.join(defaultProjectRoot, 'backups');

  logInfo(`当前脚本所在项目根目录: ${projectRoot}`);
  logInfo(`默认部署目录: ${defaultProjectRoot}`);
  logInfo('若部署路径与上述相同，直接回车即可');
  log('');

  const projectRootInput = await question('项目部署根目录（代码所在路径）', defaultProjectRoot);
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
  const now = new Date();
  const timeStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
  const backupFilePath = path.join(paths.backupPath, `fileshare.db.backup.${timeStr}`);

  await fs.copyFile(paths.dbPath, backupFilePath);
  logSuccess(`数据库已备份到: ${backupFilePath}`);
}

/**
 * 执行完整数据库 schema 迁移（新建表、索引等，与 database.js 保持一致）
 */
async function runDatabaseMigrations(paths) {
  logStep(2, '数据库迁移：同步 schema（新建表、索引等）');

  try {
    await fs.access(paths.dbPath);
  } catch {
    logWarning('数据库文件不存在，跳过迁移');
    return;
  }

  const { runMigrations } = require(path.join(paths.projectRoot, 'server', 'scripts', 'migrate-schema.js'));
  await runMigrations(paths.dbPath);
  logSuccess('数据库 schema 迁移完成');
}

async function installDependencies(projectRoot) {
  logStep(3, '安装后端依赖');
  execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('后端依赖安装完成');

  logStep(4, '安装前端依赖');
  execSync('npm install', { cwd: path.join(projectRoot, 'client'), stdio: 'inherit' });
  logSuccess('前端依赖安装完成');
}

async function buildFrontend(projectRoot) {
  logStep(5, '构建前端');
  execSync('npm run client:build', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('前端构建完成');
}

async function doUpdateVersion(projectRoot) {
  logStep(6, '更新版本号');
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
    await runDatabaseMigrations(paths);
    await installDependencies(paths.projectRoot);
    await buildFrontend(paths.projectRoot);
    await doUpdateVersion(paths.projectRoot);

    log('\n========================================', 'green');
    log('  升级完成！', 'green');
    log('========================================\n', 'green');

    log('本次更新内容:', 'yellow');
    log('1. 大文件上传支持（500mb 请求体限制）');
    log('2. PM2 前后端同时启动');
    log('3. 空间管理置于文件管理之上');
    log('4. 工作台最近文件显示空间/文件夹并可点击');
    log('5. 工作台显示当前登录者真实姓名');
    log('6. 用户管理增加登录次数统计');
    log('');

    log('下一步操作:', 'yellow');
    log('1. 重启服务: pm2 restart all 或 pm2 start ecosystem.config.js');
    log('2. 若使用 Nginx: 确保配置 client_max_body_size 500m;');
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
