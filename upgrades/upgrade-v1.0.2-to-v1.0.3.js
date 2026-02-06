#!/usr/bin/env node

/**
 * 升级脚本：v1.0.2 -> v1.0.3
 *
 * 更新内容：
 * 1. 数据备份与恢复（管理后台）
 * 2. 文件操作按权限展示
 * 3. 批量文件上传
 * 4. 限流扩展至 1000 次/15分钟
 * 5. PM2 配置（ecosystem.config.js）
 * 6. 东八区北京时间
 * 7. 空间内文件搜索
 *
 * 本脚本包含前端和后端升级，部署路径相关项通过命令行交互输入。
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const VERSION_FILE = path.join(__dirname, 'version.json');
const TARGET_VERSION = '1.0.3';
const FROM_VERSION = '1.0.2';

// 颜色输出
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

/**
 * 命令行输入
 */
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

/**
 * 读取当前版本
 */
async function getCurrentVersion() {
  const content = await fs.readFile(VERSION_FILE, 'utf8');
  const versionInfo = JSON.parse(content);
  return versionInfo.currentVersion;
}

/**
 * 更新版本号
 */
async function updateVersion(newVersion) {
  const content = await fs.readFile(VERSION_FILE, 'utf8');
  const versionInfo = JSON.parse(content);
  const oldVersion = versionInfo.currentVersion;

  versionInfo.currentVersion = newVersion;
  versionInfo.upgradeHistory.push({
    version: newVersion,
    date: new Date().toISOString().split('T')[0],
    description: `从 ${oldVersion} 升级到 ${newVersion} - 数据备份、权限展示、批量上传、PM2配置、空间搜索等`
  });

  await fs.writeFile(VERSION_FILE, JSON.stringify(versionInfo, null, 2), 'utf8');
  logSuccess(`版本已更新: ${oldVersion} -> ${newVersion}`);
}

/**
 * 检查当前版本
 */
async function checkVersion() {
  const currentVersion = await getCurrentVersion();
  if (currentVersion !== FROM_VERSION) {
    logError(`版本不匹配！当前版本: ${currentVersion}, 期望版本: ${FROM_VERSION}`);
    logWarning('请确保您正在从正确的版本升级');
    process.exit(1);
  }
  logSuccess(`当前版本检查通过: ${currentVersion}`);
}

/**
 * 获取部署路径（命令行输入）
 */
async function getDeploymentPaths() {
  logStep(0, '配置部署路径（直接回车使用默认值）');

  const projectRoot = path.resolve(__dirname, '..');
  const defaultDbPath = path.join(projectRoot, 'data', 'fileshare.db');
  const defaultStoragePath = path.join(projectRoot, 'storage');
  const defaultBackupPath = path.join(projectRoot, 'backups');

  logInfo(`当前脚本所在项目根目录: ${projectRoot}`);
  logInfo('若部署路径与上述相同，直接回车即可');
  log('');

  const projectRootInput = await question('项目部署根目录（代码所在路径）', projectRoot);
  const resolvedProjectRoot = path.resolve(projectRootInput);

  const dbPathInput = await question('数据库文件路径 (DB_PATH)', path.join(resolvedProjectRoot, 'data', 'fileshare.db'));
  const storagePathInput = await question('文件存储路径 (STORAGE_PATH)', path.join(resolvedProjectRoot, 'storage'));
  const backupPathInput = await question('备份文件存放路径', path.join(resolvedProjectRoot, 'backups'));

  return {
    projectRoot: resolvedProjectRoot,
    dbPath: path.resolve(dbPathInput),
    storagePath: path.resolve(storagePathInput),
    backupPath: path.resolve(backupPathInput)
  };
}

/**
 * 备份数据库
 */
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

/**
 * 安装依赖
 */
async function installDependencies(projectRoot) {
  logStep(2, '安装后端依赖');
  execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('后端依赖安装完成');

  logStep(3, '安装前端依赖');
  execSync('npm install', { cwd: path.join(projectRoot, 'client'), stdio: 'inherit' });
  logSuccess('前端依赖安装完成');
}

/**
 * 构建前端
 */
async function buildFrontend(projectRoot) {
  logStep(4, '构建前端');
  execSync('npm run client:build', { cwd: projectRoot, stdio: 'inherit' });
  logSuccess('前端构建完成');
}

/**
 * v1.0.3 新增文件内容（用于缺失时自动补全）
 */
const PATCH_FILES = {
  'client/src/components/FileActions.tsx': `import { Button, Space, Popconfirm } from 'antd'
import { FileTextOutlined, EyeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export interface FileActionsProps {
  record: any
  onPreview?: (record: any) => void
  onDownload?: (id: number, name: string) => void
  onRename?: (record: any) => void
  onMove?: (record: any) => void
  onRemoveFromSpace?: (id: number) => void
  onDelete?: (id: number) => void
  showDetail?: boolean
  showPreview?: boolean
  showDownload?: boolean
  showRename?: boolean
  showMove?: boolean
  showRemoveFromSpace?: boolean
  showDelete?: boolean
}

export default function FileActions({
  record,
  onPreview,
  onDownload,
  onRename,
  onMove,
  onRemoveFromSpace,
  onDelete,
  showDetail = true,
  showPreview = true,
  showDownload = true,
  showRename = true,
  showMove = true,
  showRemoveFromSpace = true,
  showDelete = true
}: FileActionsProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const perms = record?.user_permissions || {}
  const isAdmin = user?.role === 'admin'
  const isCreator = record?.created_by === user?.id

  const canRead = isAdmin || isCreator || perms.read
  const canDownload = isAdmin || isCreator || perms.download
  const canWrite = isAdmin || isCreator || perms.write
  const canDelete = isAdmin || isCreator || perms.delete

  return (
    <Space>
      {showDetail && canRead && (
        <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => navigate(\`/files/\${record.id}\`)}>详情</Button>
      )}
      {showPreview && canRead && onPreview && (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => onPreview(record)}>预览</Button>
      )}
      {showDownload && canDownload && onDownload && (
        <Button type="link" size="small" onClick={() => onDownload(record.id, record.original_name)}>下载</Button>
      )}
      {showRename && canWrite && onRename && (
        <Button type="link" size="small" onClick={() => onRename(record)}>重命名</Button>
      )}
      {showMove && canWrite && onMove && (
        <Button type="link" size="small" onClick={() => onMove(record)}>移动</Button>
      )}
      {showRemoveFromSpace && canWrite && record?.space_id && onRemoveFromSpace && (
        <Button type="link" size="small" onClick={() => onRemoveFromSpace(record.id)}>从空间移除</Button>
      )}
      {showDelete && canDelete && onDelete && (
        <Popconfirm title="确定要删除此文件吗？" description="文件将被移至回收站，可在回收站中恢复或永久删除" onConfirm={() => onDelete(record.id)} okText="确定" cancelText="取消" okType="danger">
          <Button type="link" size="small" danger>删除</Button>
        </Popconfirm>
      )}
    </Space>
  )
}
`,
  'client/src/utils/date.ts': `/** 东八区北京时间 */
const TIMEZONE = 'Asia/Shanghai'

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', { timeZone: TIMEZONE })
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date()
  const target = new Date(date)
  const diff = now.getTime() - target.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return \`\${days} 天前\`
  if (hours > 0) return \`\${hours} 小时前\`
  if (minutes > 0) return \`\${minutes} 分钟前\`
  return '刚刚'
}
`,
  'ecosystem.config.js': `const path = require('path');
const fs = require('fs');
const version = require('./upgrades/version.json').currentVersion || '1.0.0';
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
module.exports = {
  apps: [{
    name: 'fileshare',
    script: 'server/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    error_file: path.join(logsDir, 'server-error.log'),
    out_file: path.join(logsDir, 'server-out.log'),
    log_file: path.join(logsDir, 'server-combined.log'),
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    version
  }]
};
`,
  '.env.example': `# ==================== 基础配置 ====================
PORT=3000
NODE_ENV=development
TZ=Asia/Shanghai

# ==================== 认证配置 ====================
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# ==================== 数据库 ====================
DB_PATH=./data/fileshare.db

# ==================== 存储 ====================
STORAGE_PATH=./storage

# ==================== 安全与限流 ====================
CLIENT_URL=http://localhost:5173
RATE_LIMIT_MAX=1000

# ==================== 加密（可选） ====================
# ENCRYPTION_MODE=none
# ENCRYPTION_KEY=your-32-character-encryption-key-here

# ==================== 清理策略 ====================
# TRASH_RETENTION_DAYS=30
# VERSION_RETENTION_DAYS=30
# LOG_RETENTION_DAYS=90

# ==================== 前端开发（可选） ====================
# VITE_API_URL=http://192.168.1.100:3000
`
};

/**
 * 验证并补全升级文件
 */
async function verifyAndPatchFiles(projectRoot) {
  logStep(5, '验证并补全升级文件');

  const requiredFiles = ['package.json', 'server/index.js', 'client/package.json', 'upgrades/version.json'];
  for (const file of requiredFiles) {
    const filePath = path.join(projectRoot, file);
    try {
      await fs.access(filePath);
      logSuccess(`文件存在: ${file}`);
    } catch {
      logError(`必要文件不存在: ${file}`);
      process.exit(1);
    }
  }

  for (const [file, content] of Object.entries(PATCH_FILES)) {
    const filePath = path.join(projectRoot, file);
    try {
      await fs.access(filePath);
      logSuccess(`文件存在: ${file}`);
    } catch {
      logWarning(`文件不存在: ${file}，正在自动创建...`);
      try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
        logSuccess(`已创建: ${file}`);
      } catch (err) {
        logError(`创建失败: ${file} - ${err.message}`);
        process.exit(1);
      }
    }
  }
}

/**
 * 更新版本号
 */
async function doUpdateVersion() {
  logStep(6, '更新版本号');
  await updateVersion(TARGET_VERSION);
}

/**
 * 主函数
 */
async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 系统升级脚本', 'blue');
  log(`  从 ${FROM_VERSION} 升级到 ${TARGET_VERSION}`, 'blue');
  log('  包含前端构建 + 后端升级', 'blue');
  log('========================================\n', 'blue');

  try {
    await checkVersion();

    const paths = await getDeploymentPaths();
    log('');
    log('已配置路径:', 'yellow');
    logInfo(`项目根目录: ${paths.projectRoot}`);
    logInfo(`数据库路径: ${paths.dbPath}`);
    logInfo(`存储路径: ${paths.storagePath}`);
    logInfo(`备份路径: ${paths.backupPath}`);
    log('');

    const confirm = await question('确认以上路径并继续升级？(y/n)', 'y');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      logWarning('已取消升级');
      process.exit(0);
    }

    await backupDatabase(paths);
    await verifyAndPatchFiles(paths.projectRoot);
    await installDependencies(paths.projectRoot);
    await buildFrontend(paths.projectRoot);
    await doUpdateVersion();

    log('\n========================================', 'green');
    log('  升级完成！', 'green');
    log('========================================\n', 'green');

    log('本次更新内容:', 'yellow');
    log('1. 数据备份与恢复（管理后台）');
    log('2. 文件操作按权限展示');
    log('3. 批量文件上传');
    log('4. 限流 1000 次/15分钟');
    log('5. PM2 配置（ecosystem.config.js）');
    log('6. 东八区北京时间');
    log('7. 空间内文件搜索');
    log('');

    log('下一步操作:', 'yellow');
    log('1. 若使用 PM2: pm2 restart fileshare 或 pm2 start ecosystem.config.js');
    log('2. 若直接运行: NODE_ENV=production node server/index.js');
    log('3. 检查 .env 配置（TZ、RATE_LIMIT_MAX、CLIENT_URL 等）');
    log('');
  } catch (error) {
    logError(`\n升级失败: ${error.message}`);
    logError('请检查错误信息并重试，或联系技术支持');
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
