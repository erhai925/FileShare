#!/usr/bin/env node

/**
 * 升级脚本：v1.0.1 -> v1.0.2
 * 
 * 更新内容：
 * 1. 用户管理功能完善
 *    - 添加用户编辑功能（可修改角色、状态、真实姓名）
 *    - 添加用户删除功能
 *    - 添加重置用户密码功能
 * 2. 空间详情页优化
 *    - 文件树形结构展示作为默认展示模式
 *    - 在文件树中同时显示文件夹和文件
 *    - 支持在文件树中直接移动文件到文件夹
 * 3. 文件移动功能完善
 *    - 在文件管理界面，移动文件时可选择所在空间的文件夹
 *    - 完善后端移动文件API，确保文件只能移动到同一空间的文件夹
 * 
 * 升级日期：2024-12-XX
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

const VERSION_FILE = path.join(__dirname, 'version.json');
const TARGET_VERSION = '1.0.2';
const FROM_VERSION = '1.0.1';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
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

/**
 * 读取当前版本
 */
async function getCurrentVersion() {
  try {
    const content = await fs.readFile(VERSION_FILE, 'utf8');
    const versionInfo = JSON.parse(content);
    return versionInfo.currentVersion;
  } catch (error) {
    logError(`无法读取版本文件: ${error.message}`);
    throw error;
  }
}

/**
 * 更新版本号
 */
async function updateVersion(newVersion) {
  try {
    const content = await fs.readFile(VERSION_FILE, 'utf8');
    const versionInfo = JSON.parse(content);
    const oldVersion = versionInfo.currentVersion;
    
    versionInfo.currentVersion = newVersion;
    versionInfo.upgradeHistory.push({
      version: newVersion,
      date: new Date().toISOString().split('T')[0],
      description: `从 ${oldVersion} 升级到 ${newVersion}`
    });
    
    await fs.writeFile(VERSION_FILE, JSON.stringify(versionInfo, null, 2), 'utf8');
    logSuccess(`版本已更新: ${oldVersion} -> ${newVersion}`);
  } catch (error) {
    logError(`更新版本失败: ${error.message}`);
    throw error;
  }
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
 * 备份数据库
 */
async function backupDatabase() {
  logStep(1, '备份数据库');
  try {
    const dbPath = path.join(__dirname, '..', 'data', 'fileshare.db');
    const backupPath = path.join(__dirname, '..', 'data', `fileshare.db.backup.${Date.now()}`);
    
    // 检查数据库文件是否存在
    try {
      await fs.access(dbPath);
    } catch {
      logWarning('数据库文件不存在，跳过备份');
      return;
    }
    
    await fs.copyFile(dbPath, backupPath);
    logSuccess(`数据库已备份到: ${backupPath}`);
  } catch (error) {
    logError(`备份数据库失败: ${error.message}`);
    throw error;
  }
}

/**
 * 检查文件是否存在
 */
async function checkFileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 验证升级文件
 */
async function verifyFiles() {
  logStep(2, '验证升级文件');
  
  const filesToCheck = [
    'client/src/pages/Admin.tsx',
    'client/src/pages/SpaceDetail.tsx',
    'client/src/pages/Files.tsx',
    'server/routes/users.js',
    'server/routes/files.js',
    'server/routes/spaces.js'
  ];
  
  const projectRoot = path.join(__dirname, '..');
  let allFilesExist = true;
  
  for (const file of filesToCheck) {
    const filePath = path.join(projectRoot, file);
    const exists = await checkFileExists(filePath);
    if (exists) {
      logSuccess(`文件存在: ${file}`);
    } else {
      logError(`文件不存在: ${file}`);
      allFilesExist = false;
    }
  }
  
  if (!allFilesExist) {
    logError('部分升级文件不存在，请确保代码已正确更新');
    process.exit(1);
  }
  
  logSuccess('所有升级文件验证通过');
}

/**
 * 执行升级
 */
async function performUpgrade() {
  logStep(3, '执行升级操作');
  
  try {
    // 此版本升级主要是代码更新，不需要数据库迁移
    // 如果将来需要数据库迁移，可以在这里添加
    
    logSuccess('代码更新已完成（通过 Git 拉取或手动更新）');
    logWarning('请确保已更新以下文件：');
    log('  - client/src/pages/Admin.tsx（用户管理功能完善）');
    log('  - client/src/pages/SpaceDetail.tsx（文件树展示）');
    log('  - client/src/pages/Files.tsx（文件移动功能完善）');
    log('  - server/routes/users.js（用户管理API）');
    log('  - server/routes/files.js（文件移动API完善）');
    log('  - server/routes/spaces.js（文件树API）');
    
  } catch (error) {
    logError(`升级执行失败: ${error.message}`);
    throw error;
  }
}

/**
 * 更新 package.json 版本（可选）
 */
async function updatePackageVersion() {
  logStep(4, '更新 package.json 版本');
  
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const content = await fs.readFile(packagePath, 'utf8');
    const packageJson = JSON.parse(content);
    
    // 可选：更新 package.json 中的版本号
    // packageJson.version = TARGET_VERSION;
    // await fs.writeFile(packagePath, JSON.stringify(packageJson, null, 2), 'utf8');
    
    logSuccess('package.json 版本检查完成');
  } catch (error) {
    logWarning(`更新 package.json 版本失败: ${error.message}（可忽略）`);
  }
}

/**
 * 验证升级结果
 */
async function verifyUpgrade() {
  logStep(5, '验证升级结果');
  
  try {
    const currentVersion = await getCurrentVersion();
    if (currentVersion === TARGET_VERSION) {
      logSuccess(`升级成功！当前版本: ${currentVersion}`);
    } else {
      logError(`版本验证失败！当前版本: ${currentVersion}, 期望版本: ${TARGET_VERSION}`);
      process.exit(1);
    }
  } catch (error) {
    logError(`验证升级结果失败: ${error.message}`);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  log('\n========================================', 'blue');
  log('  FileShare 系统升级脚本', 'blue');
  log(`  从 ${FROM_VERSION} 升级到 ${TARGET_VERSION}`, 'blue');
  log('========================================\n', 'blue');
  
  try {
    // 检查版本
    await checkVersion();
    
    // 备份数据库
    await backupDatabase();
    
    // 验证文件
    await verifyFiles();
    
    // 执行升级
    await performUpgrade();
    
    // 更新 package.json（可选）
    await updatePackageVersion();
    
    // 更新版本号
    await updateVersion(TARGET_VERSION);
    
    // 验证升级结果
    await verifyUpgrade();
    
    log('\n========================================', 'green');
    log('  升级完成！', 'green');
    log('========================================\n', 'green');
    
    log('本次更新内容：', 'yellow');
    log('1. 用户管理功能完善（编辑、删除、重置密码）');
    log('2. 空间详情页文件树展示（默认展示模式）');
    log('3. 文件移动到文件夹功能完善\n');
    
    log('下一步操作：', 'yellow');
    log('1. 重启系统服务');
    log('2. 测试用户管理功能');
    log('3. 测试文件树展示和文件移动功能\n');
    
  } catch (error) {
    logError(`\n升级失败: ${error.message}`);
    logError('请检查错误信息并重试，或联系技术支持');
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main().catch(error => {
    logError(`未处理的错误: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
