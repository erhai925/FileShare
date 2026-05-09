#!/usr/bin/env node

/**
 * 升级脚本：v1.0.13 -> v1.0.14
 *
 * 主题：新增 Wiki 知识库模块（团队故障经验沉淀 / 全文检索 / 协作）
 *
 * 数据库变更：
 * 1. spaces 表新增 space_kind 列（'file' | 'wiki'，老数据回填 'file'）
 * 2. permissions 表 CHECK 约束扩展支持 'wiki_page' 资源类型（重建表迁移数据）
 * 3. 新增 10 张 wiki_* 表：wiki_pages / wiki_page_versions / wiki_tags /
 *    wiki_page_tags / wiki_favorites / wiki_page_views / wiki_page_links /
 *    wiki_page_attachments / wiki_subscriptions / wiki_comments
 * 4. 新增配套索引
 *
 * 升级流程：
 *   1) git pull 拉取最新代码
 *   2) 在 client 目录执行 npm install 与 npm run client:build 构建前端
 *   3) 运行本脚本（npm run upgrade 或 npm run upgrade:1.0.14），脚本会：
 *      - 自动调用 db.init() 应用 schema 变更（幂等）
 *      - 写入新版本号到 upgrades/version.json
 *   4) 重启服务（pm2 restart fileshare）
 *
 * 幂等性：重复运行不会损坏数据。新表使用 CREATE IF NOT EXISTS；
 * spaces.space_kind 通过 PRAGMA 检查是否已存在；permissions 重建仅在 CHECK 约束
 * 不含 'wiki_page' 时触发。
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

const TARGET_VERSION = '1.0.14';
const FROM_VERSION = '1.0.13';

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
    description: '从 1.0.13 升级到 1.0.14 - 新增 Wiki 知识库模块（树形目录、Markdown 编辑、版本历史、全文搜索、评论、问题-解决模板、标签、收藏、PDF 导出、附件、订阅、批量操作）'
  });

  await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
  log(`版本已更新: ${oldVersion} -> ${TARGET_VERSION}`, 'green');
  return 'updated';
}

// 触发数据库 schema 迁移：调用 db.init() 会自动执行 createTables / ensureSpaceKind /
// ensurePermissionsResourceType 等幂等迁移函数（已在 server/config/database.js 中定义）
async function migrateDatabase(projectRoot) {
  log('\n正在应用数据库 schema 迁移...', 'blue');
  process.chdir(projectRoot);
  // 加载项目本地的 dotenv 配置（DB_PATH 等环境变量）
  try { require(path.join(projectRoot, 'node_modules', 'dotenv')).config(); } catch (e) {}
  const db = require(path.join(projectRoot, 'server', 'config', 'database'));
  await db.init();
  await db.close();
  log('数据库 schema 迁移完成（幂等）', 'green');
}

async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 升级脚本 v1.0.13 -> v1.0.14', 'blue');
  log('  新增 Wiki 知识库模块', 'blue');
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

  // 先做数据库迁移，再写版本号（避免迁移失败但版本号已更新）
  if (currentVersion === FROM_VERSION) {
    await migrateDatabase(projectRoot);
  } else if (currentVersion === TARGET_VERSION) {
    log('当前版本已为 1.0.14，跳过数据库迁移（如需强制重跑可重置 version.json）', 'yellow');
  }

  const result = await updateVersion(projectRoot);

  log('\n本次更新：', 'yellow');
  log('1. 新增「Wiki」顶部入口与 /api/wiki/* 后端路由');
  log('2. 知识库（Wiki Space）：复用 spaces 表，space_kind=\'wiki\' 区分');
  log('3. 页面树形目录、父子层级、拖拽排序、软删除回收站（30 天保留）');
  log('4. Markdown 编辑器（@uiw/react-md-editor）+ 实时预览 + TOC');
  log('5. 版本历史 + 行级 diff + 一键回滚 + 乐观锁冲突检测');
  log('6. 全文搜索（标题 + 正文）+ 标签 + 收藏 + 浏览量');
  log('7. 评论与 @ 提及（独立 wiki_comments 表，复用现有逻辑模式）');
  log('8. 「问题-解决」结构化模板（沉淀工单经验）');
  log('9. 附件管理：上传新文件或挂载已有文件，权限运行时复合校验');
  log('10. 草稿/发布双状态、PDF 导出、订阅、批量操作、页面归档');
  log('11. 两级混合权限：知识库级 + 页面级覆盖（复用 permissions 表）');
  log('12. 操作日志全覆盖（复用 operation_logs，新增 wiki_* action）');

  if (result === 'already_target') {
    log('\n说明：若 version.json 已为 v1.0.14，仅表示版本号无需再次写入；仍请完成代码拉取、前端构建、重启服务。', 'yellow');
  }
  log('\n请确认已执行 git pull 拉取最新代码、在 client 目录执行 npm install 与 npm run client:build 构建前端，然后重启服务。', 'yellow');
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
