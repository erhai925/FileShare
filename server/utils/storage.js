const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

/**
 * 获取存储路径
 * 优先级：数据库配置 > 环境变量 > 默认值
 */
async function getStoragePath() {
  try {
    // 先从数据库读取配置
    const config = await db.get(
      'SELECT config_value FROM system_config WHERE config_key = ?',
      ['storage_path']
    );
    
    if (config && config.config_value) {
      return config.config_value;
    }
  } catch (error) {
    console.warn('读取存储路径配置失败，使用环境变量或默认值:', error.message);
  }
  
  // 如果数据库中没有配置，使用环境变量或默认值
  return process.env.STORAGE_PATH || './storage';
}

/**
 * 设置存储路径
 */
async function setStoragePath(storagePath) {
  await db.run(
    `INSERT OR REPLACE INTO system_config (config_key, config_value, description, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    ['storage_path', storagePath, '文件存储根路径，支持本地路径和网络路径（如NAS）']
  );
}

/**
 * 验证存储路径
 * @param {string} storagePath - 要验证的存储路径
 * @returns {Promise<{valid: boolean, message: string, writable: boolean}>}
 */
async function validateStoragePath(storagePath) {
  try {
    // 检查路径是否为空
    if (!storagePath || storagePath.trim() === '') {
      return {
        valid: false,
        message: '存储路径不能为空',
        writable: false
      };
    }

    // 规范化路径
    const normalizedPath = path.resolve(storagePath);

    // 检查路径是否存在
    try {
      const stats = await fs.stat(normalizedPath);
      
      // 检查是否为目录
      if (!stats.isDirectory()) {
        return {
          valid: false,
          message: '指定的路径不是目录',
          writable: false
        };
      }
    } catch (error) {
      // 路径不存在，尝试创建
      try {
        await fs.mkdir(normalizedPath, { recursive: true });
      } catch (mkdirError) {
        return {
          valid: false,
          message: `无法创建存储目录: ${mkdirError.message}`,
          writable: false
        };
      }
    }

    // 检查是否可写
    let writable = false;
    try {
      const testFile = path.join(normalizedPath, '.write_test_' + Date.now());
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      writable = true;
    } catch (error) {
      return {
        valid: true,
        message: `目录存在但不可写: ${error.message}`,
        writable: false
      };
    }

    // 注意：Node.js 不直接支持获取磁盘空间
    // 如需获取可用空间，可以使用第三方库如 'check-disk-space' 或 'node-disk-info'
    // 这里暂时不实现，避免增加额外依赖

    return {
      valid: true,
      message: '存储路径验证通过',
      writable: true,
      path: normalizedPath
    };
  } catch (error) {
    return {
      valid: false,
      message: `验证存储路径失败: ${error.message}`,
      writable: false
    };
  }
}

/**
 * 初始化存储目录结构
 */
async function initStorageDirectories(storagePath) {
  const dirs = ['files', 'encrypted', 'versions', 'trash', 'temp'];
  
  for (const dir of dirs) {
    const dirPath = path.join(storagePath, dir);
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error(`创建存储子目录失败: ${dirPath}`, error);
      throw error;
    }
  }
}

module.exports = {
  getStoragePath,
  setStoragePath,
  validateStoragePath,
  initStorageDirectories
};

