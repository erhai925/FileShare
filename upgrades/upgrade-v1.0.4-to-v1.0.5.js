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
 * 6. 工作台：系统版本号、上传排行榜前5名
 * 7. 工作台版本显示：新增 /api/version 接口，修复版本号展示错误
 *
 * 文件覆盖：完全覆盖部署目录下的 client/src 和 server（从升级包复制）
 * 数据库迁移：执行完整 schema 同步，确保所有表、索引与当前版本一致
 * 时区：保持东八区北京时间 (TZ=Asia/Shanghai)
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// 保持东八区北京时间
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

const getVersionFilePath = (projectRoot) => path.join(projectRoot || path.resolve(__dirname, '..'), 'upgrades', 'version.json');
const SOURCE_ROOT = path.resolve(__dirname, '..'); // 升级包/新代码所在目录
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
  if (currentVersion === TARGET_VERSION) {
    logWarning(`当前已是 v${TARGET_VERSION}，将执行同步（覆盖文件、迁移、构建）`);
    return;
  }
  if (currentVersion !== FROM_VERSION) {
    logError(`版本不匹配！当前版本: ${currentVersion}, 期望版本: ${FROM_VERSION}`);
    logWarning('请确保您正在从正确的版本升级，或先运行对应的升级脚本');
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

  logInfo(`升级包/新代码目录: ${SOURCE_ROOT}`);
  logInfo(`默认部署目录: ${defaultProjectRoot}`);
  logInfo('若部署路径与上述相同，直接回车即可');
  log('');

  const projectRootInput = await question('项目部署根目录（将覆盖其 client/src 和 server）', defaultProjectRoot);
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
 * 完全覆盖部署目录下的 client/src 和 server（从升级包复制到部署路径）
 * 使用临时目录避免源=目标时自覆盖问题
 */
async function overwriteClientAndServer(paths) {
  logStep(2, '覆盖 client/src 和 server 目录');

  const targetRoot = paths.projectRoot;
  const srcClientSrc = path.join(SOURCE_ROOT, 'client', 'src');
  const srcServer = path.join(SOURCE_ROOT, 'server');
  const targetClientSrc = path.join(targetRoot, 'client', 'src');
  const targetServer = path.join(targetRoot, 'server');

  try {
    await fs.access(srcClientSrc);
    await fs.access(srcServer);
  } catch (err) {
    throw new Error(`升级包目录不完整，缺少 client/src 或 server，请确保从完整升级包运行。路径: ${SOURCE_ROOT}`);
  }

  const tempDir = path.join(targetRoot, '.upgrade-temp-' + Date.now());

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // 复制到临时目录
    await fs.cp(srcClientSrc, path.join(tempDir, 'client_src'), { recursive: true, force: true });
    await fs.cp(srcServer, path.join(tempDir, 'server'), { recursive: true, force: true });

    // 删除目标并替换
    await fs.rm(targetClientSrc, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(path.join(targetRoot, 'client'), { recursive: true });
    await fs.rename(path.join(tempDir, 'client_src'), targetClientSrc);

    await fs.rm(targetServer, { recursive: true, force: true }).catch(() => {});
    await fs.rename(path.join(tempDir, 'server'), targetServer);

    logSuccess('client/src 和 server 已完全覆盖');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runDatabaseMigrations(paths) {
  logStep(3, '数据库迁移：同步 schema（新建表、索引等）');

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
  logStep(4, '安装后端依赖');
  execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('后端依赖安装完成');

  logStep(5, '安装前端依赖');
  execSync('npm install', { cwd: path.join(projectRoot, 'client'), stdio: 'inherit' });
  logSuccess('前端依赖安装完成');
}

async function buildFrontend(projectRoot) {
  logStep(6, '构建前端');
  execSync('npm run client:build', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('前端构建完成');
}

async function doUpdateVersion(projectRoot) {
  logStep(7, '更新版本号');
  const currentVersion = await getCurrentVersion(projectRoot);
  if (currentVersion === TARGET_VERSION) {
    logSuccess(`版本已是 v${TARGET_VERSION}，跳过更新`);
    return;
  }
  await updateVersion(projectRoot, TARGET_VERSION);
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 系统升级脚本', 'blue');
  log(`  从 ${FROM_VERSION} 升级到 ${TARGET_VERSION}`, 'blue');
  log('  含数据库 schema 迁移（新建表、索引等）', 'blue');
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
    await overwriteClientAndServer(paths);
    await runDatabaseMigrations(paths);
    await installDependencies(paths.projectRoot);
    await buildFrontend(paths.projectRoot);
    await doUpdateVersion(paths.projectRoot);

    log('\n========================================', 'green');
    log('  升级完成！', 'green');
    log('========================================\n', 'green');

    log('本次更新内容:', 'yellow');
    log('1. 文件覆盖：client/src 和 server 已完全替换为新版本');
    log('2. 数据库：执行完整 schema 迁移，确保所有表、索引与当前版本一致');
    log('3. 限流优化：上传接口排除限流，信任代理正确识别 IP');
    log('4. 限流仅返回 429，绝不修改用户密码');
    log('5. 大文件上传：无 Nginx 时可设 UPLOAD_TIMEOUT_MS=600000 延长超时');
    log('6. 429 时不再登出，仅提示「请求过于频繁，请 15 分钟后再试」');
    log('7. 工作台：系统版本号、上传排行榜前5名');
    log('8. 工作台版本显示：新增 /api/version 接口，修复版本号展示');
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
