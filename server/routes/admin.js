const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');

const router = express.Router();

// 获取系统统计信息
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    // 用户统计
    const userStats = await db.get(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins
       FROM users`
    );
    
    // 文件统计（排除已删除的文件）
    const fileStats = await db.get(
      `SELECT 
        COUNT(*) as total,
        SUM(file_size) as total_size,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted
       FROM files
       WHERE deleted_at IS NULL`
    );
    
    // 空间统计
    const spaceStats = await db.get(
      `SELECT COUNT(*) as total FROM spaces`
    );
    
    // 存储空间使用情况（递归计算所有子目录）
    const fs = require('fs').promises;
    const path = require('path');
    const { getStoragePath } = require('../utils/storage');
    const storagePath = await getStoragePath();
    
    // 递归计算目录大小
    async function calculateDirSize(dirPath) {
      let totalSize = 0;
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            totalSize += await calculateDirSize(fullPath);
          } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          }
        }
      } catch (error) {
        // 忽略无法访问的目录
        console.warn(`无法访问目录: ${dirPath}`, error.message);
      }
      return totalSize;
    }
    
    let storageSize = 0;
    try {
      storageSize = await calculateDirSize(storagePath);
    } catch (error) {
      console.error('计算存储空间失败:', error);
    }
    
    res.json({
      success: true,
      data: {
        users: userStats,
        files: {
          ...fileStats,
          total_size: fileStats.total_size || 0
        },
        spaces: spaceStats,
        storage: {
          used: storageSize,
          used_mb: (storageSize / 1024 / 1024).toFixed(2),
          used_gb: (storageSize / 1024 / 1024 / 1024).toFixed(2)
        }
      }
    });
  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(500).json({ success: false, message: '获取统计信息失败' });
  }
});

// 获取系统配置
router.get('/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const configs = await db.query('SELECT * FROM system_config');
    
    const configMap = {};
    configs.forEach(config => {
      configMap[config.config_key] = config.config_value;
    });
    
    res.json({ success: true, data: configMap });
  } catch (error) {
    console.error('获取系统配置失败:', error);
    res.status(500).json({ success: false, message: '获取系统配置失败' });
  }
});

// 更新系统配置
router.post('/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const { configs } = req.body;
    
    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({ success: false, message: '配置格式错误' });
    }
    
    for (const [key, value] of Object.entries(configs)) {
      await db.run(
        `INSERT OR REPLACE INTO system_config (config_key, config_value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [key, String(value)]
      );
    }
    
    await logOperation(req.user.id, 'update_system_config', 'system', null, {
      configs: Object.keys(configs)
    }, req);
    
    res.json({ success: true, message: '系统配置更新成功' });
  } catch (error) {
    console.error('更新系统配置失败:', error);
    res.status(500).json({ success: false, message: '更新系统配置失败' });
  }
});

// 清理回收站
router.post('/cleanup-trash', authenticate, requireAdmin, async (req, res) => {
  try {
    const retentionDays = parseInt(process.env.TRASH_RETENTION_DAYS) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const result = await db.run(
      `DELETE FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
      [cutoffDate.toISOString()]
    );
    
    await logOperation(req.user.id, 'cleanup_trash', 'system', null, {
      filesDeleted: result.changes
    }, req);
    
    res.json({
      success: true,
      message: `已清理 ${result.changes} 个过期文件`
    });
  } catch (error) {
    console.error('清理回收站失败:', error);
    res.status(500).json({ success: false, message: '清理回收站失败' });
  }
});

// 清理过期版本
router.post('/cleanup-versions', authenticate, requireAdmin, async (req, res) => {
  try {
    const retentionDays = parseInt(process.env.VERSION_RETENTION_DAYS) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    // 获取要删除的版本
    const versions = await db.query(
      `SELECT * FROM file_versions WHERE created_at < ?`,
      [cutoffDate.toISOString()]
    );
    
    let deletedCount = 0;
    const fs = require('fs').promises;
    
    for (const version of versions) {
      try {
        await fs.unlink(version.file_path);
        await db.run('DELETE FROM file_versions WHERE id = ?', [version.id]);
        deletedCount++;
      } catch (error) {
        console.error(`删除版本文件失败: ${version.file_path}`, error);
      }
    }
    
    await logOperation(req.user.id, 'cleanup_versions', 'system', null, {
      versionsDeleted: deletedCount
    }, req);
    
    res.json({
      success: true,
      message: `已清理 ${deletedCount} 个过期版本`
    });
  } catch (error) {
    console.error('清理版本失败:', error);
    res.status(500).json({ success: false, message: '清理版本失败' });
  }
});

// 获取存储路径配置
router.get('/storage', authenticate, requireAdmin, async (req, res) => {
  try {
    const { getStoragePath, validateStoragePath } = require('../utils/storage');
    const storagePath = await getStoragePath();
    const validation = await validateStoragePath(storagePath);
    
    res.json({
      success: true,
      data: {
        path: storagePath,
        ...validation
      }
    });
  } catch (error) {
    console.error('获取存储配置失败:', error);
    res.status(500).json({ success: false, message: '获取存储配置失败' });
  }
});

// 更新存储路径配置
router.post('/storage', authenticate, requireAdmin, async (req, res) => {
  try {
    const { setStoragePath, validateStoragePath, initStorageDirectories } = require('../utils/storage');
    const { path: newPath } = req.body;
    
    if (!newPath || typeof newPath !== 'string') {
      return res.status(400).json({ success: false, message: '存储路径不能为空' });
    }
    
    // 验证新路径
    const validation = await validateStoragePath(newPath);
    if (!validation.valid || !validation.writable) {
      return res.status(400).json({
        success: false,
        message: validation.message || '存储路径验证失败'
      });
    }
    
    // 保存配置
    await setStoragePath(newPath);
    
    // 初始化存储目录结构
    try {
      await initStorageDirectories(newPath);
    } catch (error) {
      console.error('初始化存储目录失败:', error);
      // 不阻止配置保存，只记录错误
    }
    
    await logOperation(req.user.id, 'update_storage_path', 'system', null, {
      newPath: newPath
    }, req);
    
    res.json({
      success: true,
      message: '存储路径配置更新成功',
      data: {
        path: newPath,
        ...validation
      }
    });
  } catch (error) {
    console.error('更新存储路径配置失败:', error);
    res.status(500).json({ success: false, message: '更新存储路径配置失败: ' + error.message });
  }
});

// 测试存储路径
router.post('/storage/test', authenticate, requireAdmin, async (req, res) => {
  try {
    const { validateStoragePath } = require('../utils/storage');
    const { path: testPath } = req.body;
    
    if (!testPath || typeof testPath !== 'string') {
      return res.status(400).json({ success: false, message: '存储路径不能为空' });
    }
    
    const validation = await validateStoragePath(testPath);
    
    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    console.error('测试存储路径失败:', error);
    res.status(500).json({ success: false, message: '测试存储路径失败: ' + error.message });
  }
});

module.exports = router;

