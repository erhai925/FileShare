const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { authenticate, checkPermission } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');
const { encryptFile, decryptFile, generateHash, getEncryptionMode } = require('../utils/encryption');
const db = require('../config/database');

const router = express.Router();
const { getStoragePath } = require('../utils/storage');

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10737418240; // 10GB

// 获取存储路径的辅助函数（异步）
async function getStoragePathAsync() {
  return await getStoragePath();
}

// 配置文件上传
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const storagePath = await getStoragePath();
      const tempDir = path.join(storagePath, 'temp');
      await fs.mkdir(tempDir, { recursive: true });
      cb(null, tempDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    cb(null, true);
  }
});

// 上传文件
router.post('/upload', authenticate, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ 
            success: false, 
            message: `文件大小超过限制（最大${(MAX_FILE_SIZE / 1024 / 1024 / 1024).toFixed(2)}GB）` 
          });
        }
        return res.status(400).json({ 
          success: false, 
          message: `文件上传错误: ${err.message}` 
        });
      }
      return res.status(500).json({ 
        success: false, 
        message: `文件上传失败: ${err.message}` 
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      console.error('上传失败: 未检测到文件');
      return res.status(400).json({ success: false, message: '未选择文件' });
    }
    
    let { folderId, spaceId } = req.body;
    const file = req.file;
    
    // 处理 folderId 和 spaceId：确保它们是有效的数字或 null
    // 如果前端传的是字符串 'undefined' 或 'null'，需要转换为 null
    if (folderId === 'undefined' || folderId === 'null' || folderId === '' || folderId === undefined) {
      folderId = null;
    } else {
      folderId = parseInt(folderId);
      if (isNaN(folderId)) {
        folderId = null;
      }
    }
    
    if (spaceId === 'undefined' || spaceId === 'null' || spaceId === '' || spaceId === undefined) {
      spaceId = null;
    } else {
      spaceId = parseInt(spaceId);
      if (isNaN(spaceId)) {
        spaceId = null;
      }
    }
    
    // 处理文件名编码：multer 默认使用 latin1 编码，需要转换为 UTF-8
    let originalFileName = file.originalname;
    try {
      // 尝试从 latin1 解码为 UTF-8（multer 的默认行为）
      originalFileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch (error) {
      // 如果转换失败，使用原始文件名
      console.warn('文件名编码转换失败，使用原始文件名:', error);
      originalFileName = file.originalname;
    }
    
    // 处理文件名编码，确保中文正确显示（用于日志）
    const originalName = req.file?.originalname || '';
    const decodedName = Buffer.from(originalName, 'latin1').toString('utf8');
    
    console.log('文件上传请求接收:', {
      hasFile: !!req.file,
      fileInfo: req.file ? {
        originalname: decodedName,
        originalnameEncoded: originalName,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: req.file.path
      } : null,
      userId: req.user?.id,
      body: req.body,
      willStoreAs: originalFileName // 显示将要存储到数据库的文件名
    });
    
    // 检查权限（如果有指定spaceId，需要检查权限；否则允许上传到默认位置）
    if (spaceId) {
      const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'write');
      if (!hasPermission) {
        await fs.unlink(file.path);
        return res.status(403).json({ success: false, message: '无上传权限' });
      }
    }
    
    // 如果指定了 folderId，验证文件夹是否存在且属于指定的空间
    if (folderId) {
      const folder = await db.get(
        `SELECT id, space_id FROM folders WHERE id = ?`,
        [folderId]
      );
      if (!folder) {
        await fs.unlink(file.path);
        return res.status(400).json({ success: false, message: '指定的文件夹不存在' });
      }
      // 如果同时指定了 spaceId，验证文件夹是否属于该空间
      if (spaceId && folder.space_id !== spaceId) {
        await fs.unlink(file.path);
        return res.status(400).json({ success: false, message: '文件夹不属于指定的空间' });
      }
      // 如果只指定了 folderId，使用文件夹所属的空间
      if (!spaceId) {
        spaceId = folder.space_id;
      }
    }
    
    // 如果没有指定spaceId，检查用户是否有上传权限（至少是viewer角色）
    if (!spaceId) {
      const user = await db.get('SELECT role FROM users WHERE id = ?', [req.user.id]);
      if (!user || (user.role !== 'admin' && user.role !== 'editor')) {
        await fs.unlink(file.path);
        return res.status(403).json({ success: false, message: '您的角色无上传权限，请联系管理员' });
      }
    }
    
    // 读取文件内容
    let fileBuffer;
    try {
      fileBuffer = await fs.readFile(file.path);
    } catch (error) {
      console.error('读取临时文件失败:', error);
      await fs.unlink(file.path).catch(() => {});
      return res.status(500).json({ success: false, message: '读取文件失败' });
    }
    
    // 生成文件哈希
    let fileHash;
    try {
      fileHash = generateHash(fileBuffer);
    } catch (error) {
      console.error('生成文件哈希失败:', error);
      await fs.unlink(file.path).catch(() => {});
      return res.status(500).json({ success: false, message: '生成文件哈希失败' });
    }
    
    // 加密文件（支持异步外部SDK，明文模式时直接返回原Buffer）
    let encryptionMode;
    let encryptedBuffer;
    try {
      encryptionMode = getEncryptionMode();
      encryptedBuffer = encryptFile(fileBuffer);
      if (encryptedBuffer instanceof Promise) {
        encryptedBuffer = await encryptedBuffer;
      }
      
      // 确保返回的是Buffer
      if (!Buffer.isBuffer(encryptedBuffer)) {
        encryptedBuffer = Buffer.from(encryptedBuffer);
      }
    } catch (error) {
      console.error('文件加密失败:', error);
      await fs.unlink(file.path).catch(() => {});
      return res.status(500).json({ success: false, message: '文件加密失败: ' + error.message });
    }
    
    // 根据加密模式选择存储路径和文件名
    const isEncrypted = encryptionMode && encryptionMode !== 'none' && encryptionMode !== 'plain' && encryptionMode !== '';
    const fileExtension = isEncrypted ? '.enc' : '';
    const storageSubDir = isEncrypted ? 'encrypted' : 'files';
    const fileName = `${Date.now()}-${fileHash.substring(0, 16)}${fileExtension}`;
    const storagePath = await getStoragePath();
    const filePath = path.join(storagePath, storageSubDir, fileName);
    
    // 确保存储目录存在
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (error) {
      console.error('创建存储目录失败:', error);
      await fs.unlink(file.path).catch(() => {});
      return res.status(500).json({ success: false, message: '创建存储目录失败' });
    }
    
    // 保存文件
    try {
      await fs.writeFile(filePath, encryptedBuffer);
    } catch (error) {
      console.error('保存文件失败:', error);
      await fs.unlink(file.path).catch(() => {});
      return res.status(500).json({ success: false, message: '保存文件失败: ' + error.message });
    }
    
    // 删除临时文件
    await fs.unlink(file.path);
    
    // 保存文件记录到数据库
    let result;
    try {
      result = await db.run(
        `INSERT INTO files (name, original_name, folder_id, space_id, file_path, file_size, mime_type, hash, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          originalFileName,
          originalFileName,
          folderId || null,
          spaceId || null,
          filePath,
          file.size,
          file.mimetype,
          fileHash,
          req.user.id,
          req.user.id
        ]
      );
    } catch (error) {
      console.error('保存文件记录到数据库失败:', error);
      // 删除已保存的文件
      await fs.unlink(filePath).catch(() => {});
      await fs.unlink(file.path).catch(() => {});
      return res.status(500).json({ success: false, message: '保存文件记录失败: ' + error.message });
    }
    
    // 保存初始版本
    try {
      await db.run(
        `INSERT INTO file_versions (file_id, version, file_path, file_size, hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.lastID, 1, filePath, file.size, fileHash, req.user.id]
      );
    } catch (error) {
      console.error('保存文件版本失败:', error);
      // 版本保存失败不影响主流程，只记录错误
    }
    
    await logOperation(req.user.id, 'upload_file', 'file', result.lastID, {
      fileName: originalFileName,
      fileSize: file.size
    }, req);
    
    res.json({
      success: true,
      message: '文件上传成功',
      data: {
        fileId: result.lastID,
        fileName: originalFileName,
        fileSize: file.size
      }
    });
  } catch (error) {
    console.error('文件上传失败 - 详细错误信息:');
    console.error('错误类型:', error.constructor.name);
    console.error('错误消息:', error.message);
    console.error('错误堆栈:', error.stack);
    console.error('请求文件:', req.file);
    console.error('请求用户:', req.user);
    
    // 清理临时文件
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
        console.log('临时文件已清理:', req.file.path);
      } catch (e) {
        console.error('清理临时文件失败:', e);
      }
    }
    
    // 返回详细的错误信息
    let errorMessage = '文件上传失败';
    if (error.code === 'LIMIT_FILE_SIZE') {
      errorMessage = `文件大小超过限制（最大${(MAX_FILE_SIZE / 1024 / 1024 / 1024).toFixed(2)}GB）`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name
      } : undefined
    });
  }
});

// 下载文件
router.get('/download/:fileId', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // 获取文件信息
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }
    
    // 下载权限检查：默认允许下载
    // 如果需要实现"禁止下载"功能，可以在权限表中设置特殊标记
    // 目前简化处理：有read权限就可以下载
    
    // 检查文件是否存在
    try {
      await fs.access(file.file_path);
    } catch (error) {
      console.error('文件不存在:', file.file_path);
      return res.status(404).json({ success: false, message: '文件不存在或已被删除' });
    }
    
    // 读取文件
    let fileBuffer;
    try {
      fileBuffer = await fs.readFile(file.file_path);
    } catch (error) {
      console.error('读取文件失败:', error);
      return res.status(500).json({ success: false, message: '读取文件失败: ' + error.message });
    }
    
    // 解密文件（支持异步外部SDK，明文模式时直接返回原Buffer）
    let decryptedBuffer;
    try {
      decryptedBuffer = decryptFile(fileBuffer);
      if (decryptedBuffer instanceof Promise) {
        decryptedBuffer = await decryptedBuffer;
      }
      
      // 确保返回的是Buffer
      if (!Buffer.isBuffer(decryptedBuffer)) {
        decryptedBuffer = Buffer.from(decryptedBuffer);
      }
    } catch (error) {
      console.error('文件解密失败:', error);
      return res.status(500).json({ success: false, message: '文件解密失败: ' + error.message });
    }
    
    await logOperation(req.user.id, 'download_file', 'file', fileId, {
      fileName: file.original_name
    }, req);
    
    // 设置响应头
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Length', decryptedBuffer.length);
    
    res.send(decryptedBuffer);
  } catch (error) {
    console.error('文件下载失败:', error);
    res.status(500).json({ success: false, message: '文件下载失败' });
  }
});

// 获取文件列表
router.get('/list', authenticate, async (req, res) => {
  try {
    const { folderId, spaceId, keyword, page = 1, pageSize = 50 } = req.query;
    
    let sql = `SELECT f.*, 
      u1.username as creator_name, 
      u2.username as updater_name,
      s.name as space_name, s.id as space_id
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN users u2 ON f.updated_by = u2.id
      LEFT JOIN spaces s ON f.space_id = s.id
      WHERE f.deleted_at IS NULL`;
    const params = [];
    
    // 非管理员只能看到自己上传的文件或有权限的文件
    if (req.user.role !== 'admin') {
      sql += ` AND (f.created_by = ? OR EXISTS (
        SELECT 1 FROM permissions p
        WHERE p.resource_type = 'file'
        AND p.resource_id = f.id
        AND (p.user_id = ? OR p.group_id IN (
          SELECT group_id FROM user_group_members WHERE user_id = ?
        ))
      ))`;
      params.push(req.user.id, req.user.id, req.user.id);
    }
    
    // 关键词搜索（文件名）
    if (keyword) {
      sql += ` AND (f.name LIKE ? OR f.original_name LIKE ?)`;
      const keywordPattern = `%${keyword}%`;
      params.push(keywordPattern, keywordPattern);
    }
    
    if (folderId) {
      sql += ` AND f.folder_id = ?`;
      params.push(folderId);
    }
    
    if (spaceId) {
      sql += ` AND f.space_id = ?`;
      params.push(spaceId);
    }
    
    sql += ` ORDER BY f.updated_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
    
    const files = await db.query(sql, params);
    
    // 获取总数
    let countSql = `SELECT COUNT(*) as total FROM files f WHERE f.deleted_at IS NULL`;
    const countParams = [];
    
    // 非管理员只能看到自己上传的文件或有权限的文件
    if (req.user.role !== 'admin') {
      countSql += ` AND (f.created_by = ? OR EXISTS (
        SELECT 1 FROM permissions p
        WHERE p.resource_type = 'file'
        AND p.resource_id = f.id
        AND (p.user_id = ? OR p.group_id IN (
          SELECT group_id FROM user_group_members WHERE user_id = ?
        ))
      ))`;
      countParams.push(req.user.id, req.user.id, req.user.id);
    }
    
    // 关键词搜索（文件名）
    if (keyword) {
      countSql += ` AND (f.name LIKE ? OR f.original_name LIKE ?)`;
      const keywordPattern = `%${keyword}%`;
      countParams.push(keywordPattern, keywordPattern);
    }
    
    if (folderId) {
      countSql += ` AND f.folder_id = ?`;
      countParams.push(folderId);
    }
    if (spaceId) {
      countSql += ` AND f.space_id = ?`;
      countParams.push(spaceId);
    }
    const totalResult = await db.get(countSql, countParams);
    
    res.json({
      success: true,
      data: {
        files,
        total: totalResult?.total || 0,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('获取文件列表失败:', error);
    res.status(500).json({ success: false, message: '获取文件列表失败' });
  }
});

// 删除文件（移至回收站）
router.delete('/:fileId', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await db.get('SELECT * FROM files WHERE id = ?', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'delete');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无删除权限' });
    }
    
    // 软删除
    const result = await db.run(
      'UPDATE files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
      [fileId]
    );
    
    console.log('删除文件操作结果:', {
      fileId,
      fileName: file.original_name,
      changes: result.changes,
      userId: req.user.id
    });
    
    // 验证删除是否成功
    const deletedFile = await db.get('SELECT id, deleted_at FROM files WHERE id = ?', [fileId]);
    console.log('删除后的文件状态:', deletedFile);
    
    await logOperation(req.user.id, 'delete_file', 'file', fileId, {
      fileName: file.original_name
    }, req);
    
    res.json({ success: true, message: '文件已移至回收站' });
  } catch (error) {
    console.error('删除文件失败:', error);
    res.status(500).json({ success: false, message: '删除文件失败' });
  }
});

// 获取回收站文件列表
router.get('/trash/list', authenticate, async (req, res) => {
  try {
    const { page = 1, pageSize = 50 } = req.query;
    
    let sql = `SELECT f.*, 
      u1.username as creator_name, 
      u2.username as updater_name,
      s.name as space_name
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN users u2 ON f.updated_by = u2.id
      LEFT JOIN spaces s ON f.space_id = s.id
      WHERE f.deleted_at IS NOT NULL`;
    const params = [];
    
    // 非管理员只能看到自己创建的文件
    // 简化逻辑：先确保基本功能正常，只显示用户创建的文件
    if (req.user.role !== 'admin') {
      sql += ` AND f.created_by = ?`;
      params.push(req.user.id);
    }
    
    sql += ` ORDER BY f.deleted_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
    
    console.log('回收站查询SQL:', sql);
    console.log('回收站查询参数:', params);
    console.log('当前用户:', { id: req.user.id, role: req.user.role, username: req.user.username });
    
    const files = await db.query(sql, params);
    
    console.log('回收站查询结果数量:', files?.length || 0);
    if (files && files.length > 0) {
      console.log('回收站文件示例:', files[0]);
    } else {
      // 检查是否有任何已删除的文件
      const allDeleted = await db.query('SELECT id, original_name, deleted_at, created_by FROM files WHERE deleted_at IS NOT NULL LIMIT 5');
      console.log('数据库中所有已删除的文件:', allDeleted);
    }
    
    // 获取总数
    let countSql = `SELECT COUNT(*) as total FROM files f WHERE f.deleted_at IS NOT NULL`;
    const countParams = [];
    
    if (req.user.role !== 'admin') {
      countSql += ` AND f.created_by = ?`;
      countParams.push(req.user.id);
    }
    
    const totalResult = await db.get(countSql, countParams);
    
    console.log('回收站总数:', totalResult?.total || 0);
    
    res.json({
      success: true,
      data: {
        files,
        total: totalResult?.total || 0,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('获取回收站列表失败:', error);
    res.status(500).json({ success: false, message: '获取回收站列表失败' });
  }
});

// 恢复文件（从回收站恢复）
router.post('/:fileId/restore', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NOT NULL', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在或不在回收站中' });
    }
    
    // 检查权限：只有文件创建者或管理员可以恢复
    if (req.user.role !== 'admin' && file.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: '无恢复权限' });
    }
    
    // 恢复文件（清除 deleted_at）
    await db.run(
      'UPDATE files SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?',
      [req.user.id, fileId]
    );
    
    await logOperation(req.user.id, 'restore_file', 'file', fileId, {
      fileName: file.original_name
    }, req);
    
    res.json({ success: true, message: '文件已恢复' });
  } catch (error) {
    console.error('恢复文件失败:', error);
    res.status(500).json({ success: false, message: '恢复文件失败' });
  }
});

// 永久删除文件（从回收站彻底删除）
router.delete('/:fileId/permanent', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NOT NULL', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在或不在回收站中' });
    }
    
    // 检查权限：只有文件创建者或管理员可以永久删除
    if (req.user.role !== 'admin' && file.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: '无删除权限' });
    }
    
    // 删除文件记录和物理文件
    try {
      // 删除物理文件
      await fs.unlink(file.file_path).catch(() => {
        console.warn('物理文件不存在或已删除:', file.file_path);
      });
      
      // 删除文件版本
      const versions = await db.query('SELECT * FROM file_versions WHERE file_id = ?', [fileId]);
      for (const version of versions) {
        await fs.unlink(version.file_path).catch(() => {});
      }
      await db.run('DELETE FROM file_versions WHERE file_id = ?', [fileId]);
      
      // 删除文件记录
      await db.run('DELETE FROM files WHERE id = ?', [fileId]);
      
      // 删除相关权限
      await db.run('DELETE FROM permissions WHERE resource_type = ? AND resource_id = ?', ['file', fileId]);
      
      // 删除相关评论
      await db.run('DELETE FROM comments WHERE file_id = ?', [fileId]);
      
      // 删除相关分享
      await db.run('DELETE FROM external_shares WHERE resource_type = ? AND resource_id = ?', ['file', fileId]);
    } catch (error) {
      console.error('删除文件相关数据失败:', error);
    }
    
    await logOperation(req.user.id, 'permanent_delete_file', 'file', fileId, {
      fileName: file.original_name
    }, req);
    
    res.json({ success: true, message: '文件已永久删除' });
  } catch (error) {
    console.error('永久删除文件失败:', error);
    res.status(500).json({ success: false, message: '永久删除文件失败' });
  }
});

// 移动文件到空间
router.patch('/:fileId/move', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { spaceId, folderId } = req.body;
    
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限：需要文件的 write 权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'write');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无移动权限' });
    }
    
    // 如果指定了空间，检查空间权限
    if (spaceId) {
      const hasSpacePermission = await checkPermission(req.user.id, 'space', spaceId, 'write');
      if (!hasSpacePermission) {
        return res.status(403).json({ success: false, message: '无目标空间权限' });
      }
      
      // 如果指定了文件夹，检查文件夹是否属于该空间
      if (folderId) {
        const folder = await db.get('SELECT * FROM folders WHERE id = ? AND space_id = ?', [folderId, spaceId]);
        if (!folder) {
          return res.status(400).json({ success: false, message: '文件夹不存在或不属于该空间' });
        }
      }
    }
    
    // 更新文件的空间和文件夹关联
    await db.run(
      'UPDATE files SET space_id = ?, folder_id = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?',
      [spaceId || null, folderId || null, req.user.id, fileId]
    );
    
    await logOperation(req.user.id, 'move_file', 'file', fileId, {
      fileName: file.original_name,
      targetSpaceId: spaceId,
      targetFolderId: folderId
    }, req);
    
    res.json({ success: true, message: '文件移动成功' });
  } catch (error) {
    console.error('移动文件失败:', error);
    res.status(500).json({ success: false, message: '移动文件失败' });
  }
});

// 从空间移除文件（将 space_id 设为 NULL）
router.patch('/:fileId/remove-from-space', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限：需要文件的 write 权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'write');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无移除权限' });
    }
    
    // 将文件从空间移除（space_id 设为 NULL，folder_id 也设为 NULL）
    await db.run(
      'UPDATE files SET space_id = NULL, folder_id = NULL, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?',
      [req.user.id, fileId]
    );
    
    await logOperation(req.user.id, 'remove_file_from_space', 'file', fileId, {
      fileName: file.original_name,
      previousSpaceId: file.space_id
    }, req);
    
    res.json({ success: true, message: '文件已从空间移除' });
  } catch (error) {
    console.error('从空间移除文件失败:', error);
    res.status(500).json({ success: false, message: '从空间移除文件失败' });
  }
});

// 重命名文件
router.patch('/:fileId/rename', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { newName } = req.body;
    
    if (!newName) {
      return res.status(400).json({ success: false, message: '新文件名不能为空' });
    }
    
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'write');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无修改权限' });
    }
    
    await db.run(
      'UPDATE files SET name = ?, original_name = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?',
      [newName, newName, req.user.id, fileId]
    );
    
    await logOperation(req.user.id, 'rename_file', 'file', fileId, {
      oldName: file.original_name,
      newName
    }, req);
    
    res.json({ success: true, message: '文件重命名成功' });
  } catch (error) {
    console.error('重命名文件失败:', error);
    res.status(500).json({ success: false, message: '重命名文件失败' });
  }
});

// 获取文件信息
router.get('/:fileId', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await db.get(
      `SELECT f.*, 
       u1.username as creator_name, u1.real_name as creator_real_name,
       u2.username as updater_name, u2.real_name as updater_real_name
       FROM files f
       LEFT JOIN users u1 ON f.created_by = u1.id
       LEFT JOIN users u2 ON f.updated_by = u2.id
       WHERE f.id = ? AND f.deleted_at IS NULL`,
      [fileId]
    );
    
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }
    
    // 获取文件版本
    const versions = await db.query(
      `SELECT v.*, u.username as creator_name
       FROM file_versions v
       LEFT JOIN users u ON v.created_by = u.id
       WHERE v.file_id = ?
       ORDER BY v.version DESC`,
      [fileId]
    );
    
    res.json({
      success: true,
      data: {
        ...file,
        versions
      }
    });
  } catch (error) {
    console.error('获取文件信息失败:', error);
    res.status(500).json({ success: false, message: '获取文件信息失败' });
  }
});

// ==================== 断点续传相关API ====================

// 初始化分块上传
router.post('/upload/init', authenticate, async (req, res) => {
  try {
    let { fileName, fileSize, mimeType, totalChunks, chunkSize, folderId, spaceId } = req.body;

    if (!fileName || !fileSize || !totalChunks || !chunkSize) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    // 处理 folderId 和 spaceId：确保它们是有效的数字或 null
    if (folderId === 'undefined' || folderId === 'null' || folderId === '' || folderId === undefined) {
      folderId = null;
    } else {
      folderId = parseInt(folderId);
      if (isNaN(folderId)) {
        folderId = null;
      }
    }
    
    if (spaceId === 'undefined' || spaceId === 'null' || spaceId === '' || spaceId === undefined) {
      spaceId = null;
    } else {
      spaceId = parseInt(spaceId);
      if (isNaN(spaceId)) {
        spaceId = null;
      }
    }

    // 检查权限
    if (spaceId) {
      const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'write');
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: '无上传权限' });
      }
    }
    
    // 如果指定了 folderId，验证文件夹是否存在且属于指定的空间
    if (folderId) {
      const folder = await db.get(
        `SELECT id, space_id FROM folders WHERE id = ?`,
        [folderId]
      );
      if (!folder) {
        return res.status(400).json({ success: false, message: '指定的文件夹不存在' });
      }
      // 如果同时指定了 spaceId，验证文件夹是否属于该空间
      if (spaceId && folder.space_id !== spaceId) {
        return res.status(400).json({ success: false, message: '文件夹不属于指定的空间' });
      }
      // 如果只指定了 folderId，使用文件夹所属的空间
      if (!spaceId) {
        spaceId = folder.space_id;
      }
    }

    // 生成上传ID
    const uploadId = crypto.randomBytes(16).toString('hex');
    
    // 设置过期时间（24小时后）
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // 保存上传记录
    await db.run(
      `INSERT INTO chunk_uploads (upload_id, user_id, file_name, file_size, mime_type, total_chunks, chunk_size, folder_id, space_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uploadId, req.user.id, fileName, fileSize, mimeType || null, totalChunks, chunkSize, folderId, spaceId, expiresAt]
    );

    res.json({
      success: true,
      data: {
        uploadId,
        chunkSize,
        totalChunks
      }
    });
  } catch (error) {
    console.error('初始化分块上传失败:', error);
    res.status(500).json({ success: false, message: '初始化上传失败: ' + error.message });
  }
});

// 上传分块
const chunkStorage = multer.memoryStorage();
const chunkUpload = multer({ storage: chunkStorage, limits: { fileSize: 100 * 1024 * 1024 } }); // 每个分块最大100MB

router.post('/upload/chunk', authenticate, chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;

    if (!uploadId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    // 查询上传记录
    const upload = await db.get(
      `SELECT * FROM chunk_uploads WHERE upload_id = ? AND user_id = ?`,
      [uploadId, req.user.id]
    );

    if (!upload) {
      return res.status(404).json({ success: false, message: '上传记录不存在' });
    }

    if (upload.status !== 'uploading') {
      return res.status(400).json({ success: false, message: `上传已${upload.status === 'completed' ? '完成' : '取消'}` });
    }

    // 检查是否过期
    if (new Date(upload.expires_at) < new Date()) {
      await db.run(`UPDATE chunk_uploads SET status = 'cancelled' WHERE id = ?`, [upload.id]);
      return res.status(400).json({ success: false, message: '上传已过期，请重新开始' });
    }

    // 解析已上传的分块
    let uploadedChunks = [];
    try {
      uploadedChunks = JSON.parse(upload.uploaded_chunks || '[]');
    } catch (e) {
      uploadedChunks = [];
    }

    // 检查分块是否已上传
    if (uploadedChunks.includes(parseInt(chunkIndex))) {
      return res.json({ success: true, message: '分块已存在' });
    }

    // 保存分块到临时目录
    const storagePath = await getStoragePath();
    const chunksDir = path.join(storagePath, 'temp', 'chunks', uploadId);
    await fs.mkdir(chunksDir, { recursive: true });

    const chunkPath = path.join(chunksDir, `chunk-${chunkIndex}`);
    await fs.writeFile(chunkPath, req.file.buffer);

    // 更新已上传分块列表
    uploadedChunks.push(parseInt(chunkIndex));
    uploadedChunks.sort((a, b) => a - b);

    await db.run(
      `UPDATE chunk_uploads SET uploaded_chunks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(uploadedChunks), upload.id]
    );

    res.json({
      success: true,
      data: {
        uploadedChunks: uploadedChunks.length,
        totalChunks: upload.total_chunks,
        progress: Math.round((uploadedChunks.length / upload.total_chunks) * 100)
      }
    });
  } catch (error) {
    console.error('上传分块失败:', error);
    res.status(500).json({ success: false, message: '上传分块失败: ' + error.message });
  }
});

// 查询上传状态
router.get('/upload/status/:uploadId', authenticate, async (req, res) => {
  try {
    const { uploadId } = req.params;

    const upload = await db.get(
      `SELECT * FROM chunk_uploads WHERE upload_id = ? AND user_id = ?`,
      [uploadId, req.user.id]
    );

    if (!upload) {
      return res.status(404).json({ success: false, message: '上传记录不存在' });
    }

    let uploadedChunks = [];
    try {
      uploadedChunks = JSON.parse(upload.uploaded_chunks || '[]');
    } catch (e) {
      uploadedChunks = [];
    }

    res.json({
      success: true,
      data: {
        uploadId: upload.upload_id,
        fileName: upload.file_name,
        status: upload.status,
        uploadedChunks: uploadedChunks.length,
        totalChunks: upload.total_chunks,
        progress: Math.round((uploadedChunks.length / upload.total_chunks) * 100),
        uploadedChunkIndices: uploadedChunks
      }
    });
  } catch (error) {
    console.error('查询上传状态失败:', error);
    res.status(500).json({ success: false, message: '查询上传状态失败: ' + error.message });
  }
});

// 完成上传（合并分块）
router.post('/upload/complete', authenticate, async (req, res) => {
  try {
    const { uploadId } = req.body;

    if (!uploadId) {
      return res.status(400).json({ success: false, message: '缺少uploadId' });
    }

    // 查询上传记录
    const upload = await db.get(
      `SELECT * FROM chunk_uploads WHERE upload_id = ? AND user_id = ?`,
      [uploadId, req.user.id]
    );

    if (!upload) {
      return res.status(404).json({ success: false, message: '上传记录不存在' });
    }

    if (upload.status === 'completed') {
      return res.json({ success: true, message: '文件已上传完成', data: { fileId: upload.file_id } });
    }

    // 解析已上传的分块
    let uploadedChunks = [];
    try {
      uploadedChunks = JSON.parse(upload.uploaded_chunks || '[]');
    } catch (e) {
      uploadedChunks = [];
    }

    // 检查是否所有分块都已上传
    if (uploadedChunks.length !== upload.total_chunks) {
      return res.status(400).json({ 
        success: false, 
        message: `分块未完整，已上传 ${uploadedChunks.length}/${upload.total_chunks}` 
      });
    }

    // 合并分块
    const storagePath = await getStoragePath();
    const chunksDir = path.join(storagePath, 'temp', 'chunks', uploadId);
    const finalFilePath = path.join(storagePath, 'temp', `merged-${uploadId}-${Date.now()}`);

    const fsSync = require('fs');
    const writeStream = fsSync.createWriteStream(finalFilePath);
    
    // 按顺序合并所有分块
    for (let i = 0; i < upload.total_chunks; i++) {
      const chunkPath = path.join(chunksDir, `chunk-${i}`);
      const chunkData = await fs.readFile(chunkPath);
      writeStream.write(chunkData);
    }
    writeStream.end();

    // 等待写入完成
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // 读取合并后的文件
    const fileBuffer = await fs.readFile(finalFilePath);

    // 生成文件哈希
    const fileHash = generateHash(fileBuffer);

    // 加密文件
    const encryptionMode = getEncryptionMode();
    const encryptedBuffer = await encryptFile(fileBuffer, encryptionMode);

    const isEncrypted = encryptionMode && encryptionMode !== 'none' && encryptionMode !== 'plain' && encryptionMode !== '';
    const fileExtension = isEncrypted ? '.enc' : '';
    const storageSubDir = isEncrypted ? 'encrypted' : 'files';
    const fileName = `${Date.now()}-${fileHash.substring(0, 16)}${fileExtension}`;
    const filePath = path.join(storagePath, storageSubDir, fileName);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, encryptedBuffer);

    // 处理文件名编码
    let originalFileName = upload.file_name;
    try {
      originalFileName = Buffer.from(upload.file_name, 'latin1').toString('utf8');
    } catch (error) {
      console.warn('文件名编码转换失败:', error);
    }

    // 保存文件记录到数据库
    const result = await db.run(
      `INSERT INTO files (name, original_name, folder_id, space_id, file_path, file_size, mime_type, hash, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        originalFileName,
        originalFileName,
        upload.folder_id || null,
        upload.space_id || null,
        filePath,
        upload.file_size,
        upload.mime_type,
        fileHash,
        req.user.id,
        req.user.id
      ]
    );

    // 保存初始版本
    try {
      await db.run(
        `INSERT INTO file_versions (file_id, version, file_path, file_size, hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.lastID, 1, filePath, upload.file_size, fileHash, req.user.id]
      );
    } catch (error) {
      console.error('保存文件版本失败:', error);
    }

    // 更新上传记录状态
    await db.run(
      `UPDATE chunk_uploads SET status = 'completed', file_id = ? WHERE id = ?`,
      [result.lastID, upload.id]
    );

    // 清理临时文件
    try {
      await fs.unlink(finalFilePath);
      await fs.rm(chunksDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('清理临时文件失败:', error);
    }

    // 记录操作日志
    await logOperation(req.user.id, 'upload_file', 'file', result.lastID, {
      fileName: originalFileName,
      fileSize: upload.file_size,
      method: 'chunked'
    }, req);

    res.json({
      success: true,
      message: '文件上传成功',
      data: {
        fileId: result.lastID,
        fileName: originalFileName,
        fileSize: upload.file_size
      }
    });
  } catch (error) {
    console.error('完成上传失败:', error);
    res.status(500).json({ success: false, message: '完成上传失败: ' + error.message });
  }
});

// 取消上传
router.post('/upload/cancel', authenticate, async (req, res) => {
  try {
    const { uploadId } = req.body;

    if (!uploadId) {
      return res.status(400).json({ success: false, message: '缺少uploadId' });
    }

    const upload = await db.get(
      `SELECT * FROM chunk_uploads WHERE upload_id = ? AND user_id = ?`,
      [uploadId, req.user.id]
    );

    if (!upload) {
      return res.status(404).json({ success: false, message: '上传记录不存在' });
    }

    // 更新状态
    await db.run(
      `UPDATE chunk_uploads SET status = 'cancelled' WHERE id = ?`,
      [upload.id]
    );

    // 清理临时文件
    try {
      const storagePath = await getStoragePath();
      const chunksDir = path.join(storagePath, 'temp', 'chunks', uploadId);
      await fs.rm(chunksDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('清理临时文件失败:', error);
    }

    res.json({ success: true, message: '上传已取消' });
  } catch (error) {
    console.error('取消上传失败:', error);
    res.status(500).json({ success: false, message: '取消上传失败: ' + error.message });
  }
});

// ==================== 在线预览相关API ====================

// 预览文件
router.get('/preview/:fileId', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { download } = req.query; // 可选：是否下载而不是预览
    
    // 获取文件信息
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }
    
    // 检查文件是否存在
    try {
      await fs.access(file.file_path);
    } catch (error) {
      console.error('文件不存在:', file.file_path);
      return res.status(404).json({ success: false, message: '文件不存在或已被删除' });
    }
    
    // 读取文件
    let fileBuffer;
    try {
      fileBuffer = await fs.readFile(file.file_path);
    } catch (error) {
      console.error('读取文件失败:', error);
      return res.status(500).json({ success: false, message: '读取文件失败: ' + error.message });
    }
    
    // 解密文件
    let decryptedBuffer;
    try {
      decryptedBuffer = decryptFile(fileBuffer);
      if (decryptedBuffer instanceof Promise) {
        decryptedBuffer = await decryptedBuffer;
      }
      
      if (!Buffer.isBuffer(decryptedBuffer)) {
        decryptedBuffer = Buffer.from(decryptedBuffer);
      }
    } catch (error) {
      console.error('文件解密失败:', error);
      return res.status(500).json({ success: false, message: '文件解密失败: ' + error.message });
    }
    
    // 确定文件类型
    let mimeType = file.mime_type || 'application/octet-stream';
    
    // 如果mimeType为空或无效，尝试根据文件扩展名推断
    if (!file.mime_type || file.mime_type === 'application/octet-stream') {
      const fileExt = path.extname(file.original_name || file.name || '').toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      };
      if (mimeTypes[fileExt]) {
        mimeType = mimeTypes[fileExt];
      }
    }
    
    const isImage = mimeType.startsWith('image/');
    const isPdf = mimeType === 'application/pdf';
    const isOffice = mimeType.includes('word') || 
                     mimeType.includes('excel') || 
                     mimeType.includes('powerpoint') ||
                     mimeType.includes('spreadsheet') ||
                     mimeType.includes('presentation') ||
                     mimeType.includes('msword') ||
                     mimeType.includes('ms-excel') ||
                     mimeType.includes('ms-powerpoint');
    
    // 如果是下载请求，直接返回文件
    if (download === 'true') {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
      res.setHeader('Content-Length', decryptedBuffer.length);
      res.send(decryptedBuffer);
      return;
    }
    
    // 设置响应头
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', decryptedBuffer.length);
    
    // 对于图片和PDF，直接返回
    if (isImage || isPdf) {
      // 设置缓存头
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(decryptedBuffer);
      return;
    }
    
    // 对于Office文档，返回提示信息（后续可以集成转换服务）
    if (isOffice) {
      // 返回一个JSON响应，提示前端需要下载或使用在线预览服务
      res.json({
        success: true,
        data: {
          fileId: file.id,
          fileName: file.original_name,
          mimeType: mimeType,
          previewable: false,
          message: 'Office文档需要下载后查看，或使用在线预览服务',
          downloadUrl: `/api/files/download/${fileId}`
        }
      });
      return;
    }
    
    // 其他文件类型，返回下载链接
    res.json({
      success: true,
      data: {
        fileId: file.id,
        fileName: file.original_name,
        mimeType: mimeType,
        previewable: false,
        message: '该文件类型不支持在线预览',
        downloadUrl: `/api/files/download/${fileId}`
      }
    });
  } catch (error) {
    console.error('预览文件失败:', error);
    res.status(500).json({ success: false, message: '预览文件失败: ' + error.message });
  }
});

module.exports = router;

