const express = require('express');
const multer = require('multer');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const crypto = require('crypto');
const { authenticate, checkPermission, getBatchFilePermissions } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');
const { encryptFile, encryptFileStreaming, decryptFile, generateHash, getEncryptionMode, generateToken } = require('../utils/encryption');
const { enqueuePresentationToPdf, getPresentationPreviewStatus } = require('../utils/office-preview');
const db = require('../config/database');

const router = express.Router();
const { getStoragePath } = require('../utils/storage');

// 已与参考 files.js（Downloads）融合：上传/下载/列表/回收站/移动/重命名/分块上传/预览/preview-public 等逻辑一致；
// 本项目额外保留：setAttachmentDisposition、resolveFilePath、getCandidateStorageRoots、authenticateOrDownloadToken、POST /download-token、download_count 更新

/** 设置下载文件名响应头（兼容中文等，使用 RFC 5987 filename*） */
function setAttachmentDisposition(res, originalName) {
  const safeAscii = (originalName || 'download').replace(/[^\x20-\x7E]/g, '_') || 'download';
  const encoded = encodeURIComponent(originalName || 'download');
  res.setHeader('Content-Disposition', `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`);
}

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10737418240; // 10GB
// 单次表单上传建议上限，超过则引导使用分块上传，避免大文件读入内存导致宕机
const SINGLE_UPLOAD_MAX = parseInt(process.env.SINGLE_UPLOAD_MAX) || 50 * 1024 * 1024; // 50MB

function isPresentationFile(fileName, mimeType) {
  const ext = path.extname(fileName || '').toLowerCase();
  return ['.ppt', '.pptx'].includes(ext) ||
    (mimeType || '').includes('powerpoint') ||
    (mimeType || '').includes('presentation');
}

function preconvertPresentationInBackground({ sourceBuffer, sourceExt, fileHash, originalName }) {
  if (!sourceBuffer || !isPresentationFile(originalName, '')) {
    return;
  }

  enqueuePresentationToPdf({ sourceBuffer, sourceExt, fileHash, originalName })
    .catch((error) => {
      console.warn('PPT/PPTX 预转换任务启动失败:', error && error.message ? error.message : error);
    });
}

async function sendPdfPreviewStream(res, pdfPath) {
  const stat = await fs.stat(pdfPath);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=3600');

  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(pdfPath);
    stream.on('error', reject);
    res.on('close', resolve);
    res.on('finish', resolve);
    stream.pipe(res);
  });
}

/** 候选存储根（当前配置 + 项目 storage + 可配置 fallback） */
async function getCandidateStorageRoots() {
  const roots = [];
  roots.push(path.resolve(await getStoragePath()));
  const cwdStorage = path.resolve(process.cwd(), 'storage');
  if (!roots.includes(cwdStorage)) roots.push(cwdStorage);
  const serverRel = path.resolve(path.join(__dirname, '..', '..', 'storage'));
  if (!roots.includes(serverRel)) roots.push(serverRel);
  if (process.env.LEGACY_STORAGE_PATHS) {
    process.env.LEGACY_STORAGE_PATHS.split(',').map(p => path.resolve(p.trim())).filter(Boolean).forEach(r => {
      if (!roots.includes(r)) roots.push(r);
    });
  }
  try {
    const row = await db.get('SELECT config_value FROM system_config WHERE config_key = ?', ['storage_path_fallbacks']);
    if (row && row.config_value) {
      const arr = JSON.parse(row.config_value);
      if (Array.isArray(arr)) arr.forEach(p => { const r = path.resolve(p); if (r && !roots.includes(r)) roots.push(r); });
    }
  } catch (e) {}
  return roots;
}

/**
 * 解析文件实际路径：若数据库中路径不存在（相对路径、存储根路径变更等），
 * 则尝试多种回退：绝对路径、当前存储根+相对路径、存储根+files/encrypted+文件名等
 */
async function resolveFilePath(file) {
  const raw = file.file_path;
  if (!raw || typeof raw !== 'string') return null;
  const stored = path.normalize(raw.trim()).replace(/^\.\//, '');
  const name = path.basename(stored);
  const roots = await getCandidateStorageRoots();
  const attempts = [
    stored,
    path.resolve(stored),
    path.join(roots[0], stored),
    path.join(roots[0], 'files', name),
    path.join(roots[0], 'encrypted', name),
    path.join(process.cwd(), stored),
    path.join(process.cwd(), 'storage', 'files', name),
    path.join(process.cwd(), 'storage', 'encrypted', name)
  ];
  for (let i = 1; i < roots.length; i++) {
    attempts.push(path.join(roots[i], 'files', name), path.join(roots[i], 'encrypted', name));
  }
  const seen = new Set();
  for (const p of attempts) {
    const canon = path.resolve(p);
    if (seen.has(canon)) continue;
    seen.add(canon);
    try {
      await fs.access(canon);
      return canon;
    } catch (e) {
      // 继续尝试下一项
    }
  }
  const dir = path.dirname(stored);
  const base = path.basename(dir);
  if (base && name && base !== '.' && base !== '..') {
    for (const root of roots) {
      for (const sub of ['', 'files', 'encrypted']) {
        const fallback = sub ? path.join(root, sub, base, name) : path.join(root, base, name);
        const canon = path.resolve(fallback);
        if (seen.has(canon)) continue;
        seen.add(canon);
        try {
          await fs.access(canon);
          return fallback;
        } catch (e2) {}
      }
    }
  }
  // 按文件名在候选根的 files/encrypted 下搜索（升级后文件可能迁移到其他根）
  for (const root of roots) {
    for (const sub of ['files', 'encrypted']) {
      const dirPath = path.join(root, sub);
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isFile() && ent.name === name) {
            const full = path.join(dirPath, ent.name);
            const canon = path.resolve(full);
            if (seen.has(canon)) continue;
            try {
              await fs.access(canon);
              return canon;
            } catch (e3) {}
          }
        }
      } catch (e4) {}
    }
  }
  console.warn('resolveFilePath 未找到文件，fileId=', file.id, 'stored=', raw, 'roots=', roots, 'tried=', Array.from(seen).slice(0, 20));
  return null;
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
  const safeRespond = (status, body) => {
    try {
      if (!res.headersSent) res.status(status).json(body);
    } catch (e) {
      console.error('上传接口响应失败:', e);
    }
  };
  try {
    if (!req.file) {
      console.error('上传失败: 未检测到文件');
      return safeRespond(400, { success: false, message: '未选择文件' });
    }

    const file = req.file;
    if (file.size > SINGLE_UPLOAD_MAX) {
      try { await fs.unlink(file.path); } catch (_) {}
      return safeRespond(400, {
        success: false,
        message: `文件超过 ${(SINGLE_UPLOAD_MAX / 1024 / 1024).toFixed(0)}MB，单次上传可能不稳定。请使用「大文件上传」或分块上传（支持断点续传）。`
      });
    }
    
    let { folderId, spaceId } = req.body;
    
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
    
    // 内容去重：同一目录下已存在相同哈希的文件时，先退回 409 让用户确认，
    // 避免"以为没反应"的重复提交把同一份文件反复入库。用户确认后带 force=1 重传。
    // 仅在写盘前拦截，此时尚未产生任何存储副本。
    const forceUpload = req.body.force === '1' || req.body.force === 'true' || req.body.force === true;
    if (!forceUpload) {
      const dup = await db.get(
        `SELECT id, original_name, created_at FROM files
         WHERE hash = ? AND deleted_at IS NULL
           AND IFNULL(folder_id, -1) = IFNULL(?, -1)
           AND IFNULL(space_id, -1) = IFNULL(?, -1)
         LIMIT 1`,
        [fileHash, folderId || null, spaceId || null]
      );
      if (dup) {
        await fs.unlink(file.path).catch(() => {});
        return safeRespond(409, {
          success: false,
          code: 'DUPLICATE_CONTENT',
          message: `当前目录已存在内容完全相同的文件「${dup.original_name}」`,
          data: { existingFileId: dup.id, existingName: dup.original_name, existingCreatedAt: dup.created_at }
        });
      }
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

    preconvertPresentationInBackground({
      sourceBuffer: fileBuffer,
      sourceExt: path.extname(originalFileName).toLowerCase(),
      fileHash,
      originalName: originalFileName
    });
  } catch (error) {
    console.error('文件上传失败 - 详细错误信息:');
    console.error('错误类型:', error.constructor.name);
    console.error('错误消息:', error.message);
    console.error('错误堆栈:', error.stack);
    
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (e) {}
    }
    
    let errorMessage = '文件上传失败';
    if (error.code === 'LIMIT_FILE_SIZE') {
      errorMessage = `文件大小超过限制（最大${(MAX_FILE_SIZE / 1024 / 1024 / 1024).toFixed(2)}GB）`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    safeRespond(500, {
      success: false,
      message: errorMessage,
      hint: '大文件请使用分块上传（支持断点续传）',
      error: process.env.NODE_ENV === 'development' ? { message: error.message, name: error.constructor.name } : undefined
    });
  }
});

// 下载：支持 Bearer 认证或 URL 上的临时 token（复制链接打开用）
async function authenticateOrDownloadToken(req, res, next) {
  const token = req.query.token;
  if (token && typeof token === 'string') {
    if (!global.downloadTokens) {
      return res.status(401).json({ success: false, message: '下载链接无效或已过期' });
    }
    const info = global.downloadTokens.get(token);
    if (!info || Date.now() > info.expiresAt) {
      if (info) global.downloadTokens.delete(token);
      return res.status(401).json({ success: false, message: '下载链接无效或已过期' });
    }
    if (String(info.fileId) !== String(req.params.fileId)) {
      return res.status(403).json({ success: false, message: '链接与文件不匹配' });
    }
    const user = await db.get('SELECT id, username, email, role, real_name FROM users WHERE id = ? AND status = ?', [info.userId, 'active']);
    if (!user) {
      global.downloadTokens.delete(token);
      return res.status(401).json({ success: false, message: '下载链接已失效' });
    }
    req.user = { id: user.id, username: user.username, email: user.email, role: user.role, realName: user.real_name };
    return next();
  }
  return authenticate(req, res, next);
}

// 生成临时下载链接 token（供复制链接后在新标签页打开）
router.post('/download-token', authenticate, async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ success: false, message: '缺少 fileId' });
    }
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    let hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');
    if (!hasPermission && file.space_id) {
      hasPermission = await checkPermission(req.user.id, 'space', file.space_id, 'read');
      if (!hasPermission) {
        const space = await db.get('SELECT owner_id FROM spaces WHERE id = ?', [file.space_id]);
        if (space && space.owner_id === req.user.id) hasPermission = true;
      }
    }
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }
    const raw = generateToken(24);
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 小时
    if (!global.downloadTokens) {
      global.downloadTokens = new Map();
      // 定期清理过期 token（每 10 分钟），避免每个 token 各自 setTimeout 导致 timer 积压
      setInterval(() => {
        const now = Date.now();
        for (const [k, v] of global.downloadTokens) {
          if (now > v.expiresAt) global.downloadTokens.delete(k);
        }
      }, 10 * 60 * 1000).unref();
    }
    global.downloadTokens.set(raw, { fileId: Number(fileId), userId: req.user.id, expiresAt });
    res.json({ success: true, data: { token: raw, expiresIn: 3600 } });
  } catch (err) {
    console.error('生成下载 token 失败:', err);
    res.status(500).json({ success: false, message: '生成下载链接失败' });
  }
});

// 下载文件
router.get('/download/:fileId', authenticateOrDownloadToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // 获取文件信息
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限
    let hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');

    // 如果文件级权限检查失败，检查空间权限
    if (!hasPermission && file.space_id) {
      hasPermission = await checkPermission(req.user.id, 'space', file.space_id, 'read');

      // 如果用户是空间所有者，也应该有权限
      if (!hasPermission) {
        const space = await db.get('SELECT owner_id FROM spaces WHERE id = ?', [file.space_id]);
        if (space && space.owner_id === req.user.id) {
          hasPermission = true;
        }
      }
    }

    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }

    const resolvedPath = await resolveFilePath(file);
    if (!resolvedPath) {
      console.error('文件不存在:', file.file_path);
      return res.status(404).json({ success: false, message: '文件不存在或已被删除' });
    }

    const encMode = getEncryptionMode();
    const isPlainMode = !encMode || encMode === 'none' || encMode === 'plain';

    // 明文模式 / AES-256：流式下载，避免大文件 OOM
    if (isPlainMode) {
      const stat = await fs.stat(resolvedPath);
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      setAttachmentDisposition(res, file.original_name);
      res.setHeader('Content-Length', stat.size);

      await logOperation(req.user.id, 'download_file', 'file', fileId, { fileName: file.original_name }, req);
      db.run('UPDATE files SET download_count = COALESCE(download_count, 0) + 1 WHERE id = ?', [fileId]).catch(() => {});

      await new Promise((resolve, reject) => {
        const stream = fsSync.createReadStream(resolvedPath);
        stream.on('error', reject);
        res.on('close', resolve);
        res.on('finish', resolve);
        stream.pipe(res);
      });
    } else if (encMode === 'aes256' || encMode === 'aes-256') {
      // AES-256 流式解密：先读取 16 字节 IV，再流式 decipher
      const stat = await fs.stat(resolvedPath);
      const ivBuf = Buffer.alloc(16);
      const fd = await fs.open(resolvedPath, 'r');
      try {
        await fd.read(ivBuf, 0, 16, 0);
      } finally {
        await fd.close();
      }
      const crypto = require('crypto');
      const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || 'default-key-change-in-production-16chars').digest();
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, ivBuf);

      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      setAttachmentDisposition(res, file.original_name);
      // CBC 解密后长度不确定（padding），不设 Content-Length

      await logOperation(req.user.id, 'download_file', 'file', fileId, { fileName: file.original_name }, req);
      db.run('UPDATE files SET download_count = COALESCE(download_count, 0) + 1 WHERE id = ?', [fileId]).catch(() => {});

      await new Promise((resolve, reject) => {
        const stream = fsSync.createReadStream(resolvedPath, { start: 16 });
        stream.on('error', reject);
        res.on('close', resolve);
        res.on('finish', resolve);
        stream.pipe(decipher).pipe(res);
      });
    } else {
      // SM4 / 外部 SDK：仍使用 buffer 模式（不支持流式）
      let fileBuffer;
      try {
        fileBuffer = await fs.readFile(resolvedPath);
      } catch (error) {
        console.error('读取文件失败:', error);
        return res.status(500).json({ success: false, message: '读取文件失败: ' + error.message });
      }

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

      await logOperation(req.user.id, 'download_file', 'file', fileId, { fileName: file.original_name }, req);
      await db.run('UPDATE files SET download_count = COALESCE(download_count, 0) + 1 WHERE id = ?', [fileId]);

      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      setAttachmentDisposition(res, file.original_name);
      res.setHeader('Content-Length', decryptedBuffer.length);
      res.send(decryptedBuffer);
    }
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
      s.name as space_name, s.id as space_id,
      (SELECT name FROM folders WHERE id = f.folder_id LIMIT 1) as folder_name
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN users u2 ON f.updated_by = u2.id
      LEFT JOIN spaces s ON f.space_id = s.id
      WHERE f.deleted_at IS NULL`;
    const params = [];
    
    // 非管理员只能看到自己上传的文件或有权限的文件
    if (req.user.role !== 'admin') {
      sql += ` AND (
        f.created_by = ? OR 
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'file'
          AND p.resource_id = f.id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'space'
          AND p.resource_id = f.space_id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM spaces s
          WHERE s.id = f.space_id
          AND s.owner_id = ?
        )
      )`;
      params.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
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
    
    let files = await db.query(sql, params);
    const permMap = await getBatchFilePermissions(req.user.id, files);
    files = files.map(f => ({ ...f, user_permissions: permMap[f.id] || {} }));

    // 获取总数
    let countSql = `SELECT COUNT(*) as total FROM files f WHERE f.deleted_at IS NULL`;
    const countParams = [];
    
    // 非管理员只能看到自己上传的文件或有权限的文件
    if (req.user.role !== 'admin') {
      countSql += ` AND (
        f.created_by = ? OR 
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'file'
          AND p.resource_id = f.id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'space'
          AND p.resource_id = f.space_id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM spaces s
          WHERE s.id = f.space_id
          AND s.owner_id = ?
        )
      )`;
      countParams.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
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
      s.name as space_name,
      (SELECT name FROM folders WHERE id = f.folder_id LIMIT 1) as folder_name
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
    
    let files = await db.query(sql, params);
    const permMap = await getBatchFilePermissions(req.user.id, files);
    files = files.map(f => ({ ...f, user_permissions: permMap[f.id] || {} }));

    // 获取总数
    let countSql = `SELECT COUNT(*) as total FROM files f WHERE f.deleted_at IS NOT NULL`;
    const countParams = [];
    
    if (req.user.role !== 'admin') {
      countSql += ` AND f.created_by = ?`;
      countParams.push(req.user.id);
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

// 永久删除文件（从回收站彻底删除；大文件删除可能较慢，延长请求超时）
router.delete('/:fileId/permanent', authenticate, async (req, res) => {
  req.setTimeout(180000);
  res.setTimeout(180000);
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
    
    // 删除物理文件与数据库记录（必须先删所有引用 files(id) 的表，最后再删 files，避免外键约束失败）
    try {
      await fs.unlink(file.file_path).catch((err) => {
        if (err.code !== 'ENOENT') console.warn('物理文件删除警告:', file.file_path, err.message);
      });

      const versions = await db.query('SELECT * FROM file_versions WHERE file_id = ?', [fileId]);
      for (const version of versions) {
        await fs.unlink(version.file_path).catch(() => {});
      }
      await db.run('DELETE FROM file_versions WHERE file_id = ?', [fileId]);

      await db.run('DELETE FROM permissions WHERE resource_type = ? AND resource_id = ?', ['file', fileId]);
      await db.run('DELETE FROM comments WHERE file_id = ?', [fileId]);
      await db.run('DELETE FROM external_shares WHERE resource_type = ? AND resource_id = ?', ['file', fileId]);
      // chunk_uploads 表有 file_id 引用 files(id)，完成上传时会写入，须先清理
      await db.run('UPDATE chunk_uploads SET file_id = NULL WHERE file_id = ?', [fileId]).catch(() => {});

      await db.run('DELETE FROM files WHERE id = ?', [fileId]);
    } catch (error) {
      console.error('删除文件相关数据失败:', error);
      return res.status(500).json({ success: false, message: '永久删除失败: ' + (error.message || '删除文件或数据库时出错') });
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
    let { spaceId, folderId } = req.body;
    
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 检查权限：需要文件的 write 权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'write');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无移动权限' });
    }
    
    // 处理 folderId：如果是 null 或空字符串，设为 null
    if (folderId === null || folderId === '' || folderId === 'null' || folderId === 'undefined') {
      folderId = null;
    } else if (folderId) {
      folderId = parseInt(folderId);
      if (isNaN(folderId)) {
        folderId = null;
      }
    }
    
    // 如果指定了文件夹，验证文件夹是否存在
    if (folderId) {
      const folder = await db.get('SELECT * FROM folders WHERE id = ?', [folderId]);
      if (!folder) {
        return res.status(400).json({ success: false, message: '文件夹不存在' });
      }
      
      // 如果文件已有空间，确保文件夹属于同一空间
      if (file.space_id && folder.space_id !== file.space_id) {
        return res.status(400).json({ success: false, message: '文件夹不属于文件所在的空间' });
      }
      
      // 如果指定了空间，确保文件夹属于该空间
      if (spaceId && folder.space_id !== parseInt(spaceId)) {
        return res.status(400).json({ success: false, message: '文件夹不属于指定的空间' });
      }
      
      // 如果只指定了文件夹，使用文件夹所属的空间
      if (!spaceId && folder.space_id) {
        spaceId = folder.space_id;
      }
    }
    
    // 如果指定了空间，检查空间权限
    if (spaceId) {
      const hasSpacePermission = await checkPermission(req.user.id, 'space', spaceId, 'write');
      if (!hasSpacePermission) {
        return res.status(403).json({ success: false, message: '无目标空间权限' });
      }
    }
    
    // 更新文件的空间和文件夹关联
    await db.run(
      'UPDATE files SET space_id = ?, folder_id = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?',
      [spaceId || file.space_id || null, folderId, req.user.id, fileId]
    );
    
    await logOperation(req.user.id, 'move_file', 'file', fileId, {
      fileName: file.original_name,
      previousSpaceId: file.space_id,
      previousFolderId: file.folder_id,
      targetSpaceId: spaceId || file.space_id,
      targetFolderId: folderId
    }, req);
    
    res.json({ success: true, message: '文件移动成功' });
  } catch (error) {
    console.error('移动文件失败:', error);
    res.status(500).json({ success: false, message: '移动文件失败: ' + error.message });
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

// ==================== 新文件通知相关API ====================

// 获取最近一周更新的文件（用于通知）
router.get('/recent-updates', authenticate, async (req, res) => {
  try {
    // 计算一周前的时间
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoStr = oneWeekAgo.toISOString().slice(0, 19).replace('T', ' ');
    
    let sql = `SELECT f.*, 
      u1.username as creator_name, 
      u2.username as updater_name,
      s.name as space_name,
      (SELECT name FROM folders WHERE id = f.folder_id LIMIT 1) as folder_name
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN users u2 ON f.updated_by = u2.id
      LEFT JOIN spaces s ON f.space_id = s.id
      WHERE f.deleted_at IS NULL
      AND f.updated_at >= ?`;
    const params = [oneWeekAgoStr];
    
    // 非管理员只能看到自己上传的文件或有权限的文件
    if (req.user.role !== 'admin') {
      sql += ` AND (
        f.created_by = ? OR 
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'file'
          AND p.resource_id = f.id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'space'
          AND p.resource_id = f.space_id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM spaces s
          WHERE s.id = f.space_id
          AND s.owner_id = ?
        )
      )`;
      params.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
    }
    
    // 排除自己更新的文件（只显示团队成员更新的文件）
    sql += ` AND f.updated_by != ?`;
    params.push(req.user.id);
    
    // 只返回真正更新的文件（排除新上传的文件，即 created_at 和 updated_at 相同的文件）
    // 或者有多个版本的文件（表示被更新过）
    sql += ` AND (f.created_at != f.updated_at OR EXISTS (
      SELECT 1 FROM file_versions fv
      WHERE fv.file_id = f.id
      AND fv.version > 1
    ))`;
    
    sql += ` ORDER BY f.updated_at DESC LIMIT 20`;
    
    const files = await db.query(sql, params);
    
    res.json({
      success: true,
      data: {
        files,
        count: files.length
      }
    });
  } catch (error) {
    console.error('获取最近更新文件失败:', error);
    res.status(500).json({ success: false, message: '获取最近更新文件失败' });
  }
});

// 获取最近一周的新文件（包括新上传和更新的，用于工作台标记）
router.get('/recent-files', authenticate, async (req, res) => {
  try {
    // 计算一周前的时间
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoStr = oneWeekAgo.toISOString().slice(0, 19).replace('T', ' ');
    
    let sql = `SELECT f.id, f.name, f.original_name, f.folder_id, f.space_id, f.file_path, 
      f.file_size, f.mime_type, f.hash, f.version, f.created_by, f.updated_by,
      f.created_at, f.updated_at, f.deleted_at,
      u1.username as creator_name, 
      u2.username as updater_name,
      s.name as space_name,
      (SELECT name FROM folders WHERE id = f.folder_id LIMIT 1) as folder_name
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN users u2 ON f.updated_by = u2.id
      LEFT JOIN spaces s ON f.space_id = s.id
      WHERE f.deleted_at IS NULL
      AND (f.created_at >= ? OR f.updated_at >= ?)`;
    const params = [oneWeekAgoStr, oneWeekAgoStr];

    // 非管理员只能看到自己上传的文件或有权限的文件
    if (req.user.role !== 'admin') {
      sql += ` AND (
        f.created_by = ? OR 
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'file'
          AND p.resource_id = f.id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'space'
          AND p.resource_id = f.space_id
          AND (p.user_id = ? OR p.group_id IN (
            SELECT group_id FROM user_group_members WHERE user_id = ?
          ))
        ) OR
        EXISTS (
          SELECT 1 FROM spaces s
          WHERE s.id = f.space_id
          AND s.owner_id = ?
        )
      )`;
      params.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
    }
    
    sql += ` ORDER BY f.updated_at DESC, f.created_at DESC LIMIT 50`;

    const files = await db.query(sql, params);

    res.json({
      success: true,
      data: {
        files,
        count: files.length
      }
    });
  } catch (error) {
    console.error('获取最近新文件失败:', error);
    res.status(500).json({ success: false, message: '获取最近新文件失败' });
  }
});

// 获取上传文件最多的前5名用户（排除 admin，显示真实姓名）
router.get('/top-uploaders', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT u.real_name, u.username, COUNT(f.id) as upload_count
       FROM files f
       JOIN users u ON f.created_by = u.id
       WHERE f.deleted_at IS NULL AND u.username != 'admin'
       GROUP BY f.created_by
       ORDER BY upload_count DESC
       LIMIT 5`
    );
    const list = rows.map(r => ({
      realName: r.real_name || r.username,
      uploadCount: r.upload_count
    }));
    res.json({ success: true, data: { list } });
  } catch (error) {
    console.error('获取上传排行榜失败:', error);
    res.status(500).json({ success: false, message: '获取上传排行榜失败' });
  }
});

// 下载次数最多的前5个文件（用于工作台-文件下载排行榜）
router.get('/top-downloads', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT f.id, f.original_name, COALESCE(f.download_count, 0) as download_count
       FROM files f
       WHERE f.deleted_at IS NULL AND COALESCE(f.download_count, 0) > 0
       ORDER BY f.download_count DESC
       LIMIT 5`
    );
    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取下载排行榜失败:', error);
    res.status(500).json({ success: false, message: '获取下载排行榜失败' });
  }
});

// 下载操作最多的前5名用户（排除 admin，用于工作台-用户下载排行榜）
router.get('/top-downloaders', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT l.user_id, u.real_name, u.username, COUNT(*) as download_count
       FROM operation_logs l
       JOIN users u ON l.user_id = u.id
       WHERE l.action = 'download_file' AND u.username != 'admin'
       GROUP BY l.user_id
       ORDER BY download_count DESC
       LIMIT 5`
    );
    const list = rows.map(r => ({
      realName: r.real_name || r.username,
      downloadCount: r.download_count
    }));
    res.json({ success: true, data: { list } });
  } catch (error) {
    console.error('获取用户下载排行榜失败:', error);
    res.status(500).json({ success: false, message: '获取用户下载排行榜失败' });
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
    let hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');

    // 如果文件级权限检查失败，检查空间权限
    if (!hasPermission && file.space_id) {
      hasPermission = await checkPermission(req.user.id, 'space', file.space_id, 'read');

      if (!hasPermission) {
        const space = await db.get('SELECT owner_id FROM spaces WHERE id = ?', [file.space_id]);
        if (space && space.owner_id === req.user.id) {
          hasPermission = true;
        }
      }
    }

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

    // 合并分块（流式写入，避免大文件 OOM）
    const storagePath = await getStoragePath();
    const chunksDir = path.join(storagePath, 'temp', 'chunks', uploadId);
    const finalFilePath = path.join(storagePath, 'temp', `merged-${uploadId}-${Date.now()}`);

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

    // 流式加密/复制到最终路径，避免整文件读入内存导致 OOM（大视频等文件）
    const encryptionMode = getEncryptionMode();
    const isEncrypted = encryptionMode && encryptionMode !== 'none' && encryptionMode !== 'plain' && encryptionMode !== '';
    const fileExtension = isEncrypted ? '.enc' : '';
    const storageSubDir = isEncrypted ? 'encrypted' : 'files';
    await fs.mkdir(path.join(storagePath, storageSubDir), { recursive: true });
    const tempEncPath = path.join(storagePath, storageSubDir, `merged-enc-${uploadId}-${Date.now()}${fileExtension}`);

    const fileHash = await encryptFileStreaming(finalFilePath, tempEncPath);

    const fileName = `${Date.now()}-${fileHash.substring(0, 16)}${fileExtension}`;
    const filePath = path.join(storagePath, storageSubDir, fileName);
    await fs.rename(tempEncPath, filePath);

    // 分块上传的 file_name 来自客户端 JSON（已是 UTF-8），直接使用，不做 latin1 转换
    const originalFileName = upload.file_name || '';

    // 内容去重：与普通上传不同，此处字节已全部传完并合并落盘，退回 409 只会
    // 白白浪费整次传输，故不阻拦，仅在响应里回带重复信息由前端提示，用户自行决定是否删除。
    const dupExisting = await db.get(
      `SELECT id, original_name FROM files
       WHERE hash = ? AND deleted_at IS NULL
         AND IFNULL(folder_id, -1) = IFNULL(?, -1)
         AND IFNULL(space_id, -1) = IFNULL(?, -1)
       LIMIT 1`,
      [fileHash, upload.folder_id || null, upload.space_id || null]
    );

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

    const shouldPreconvertPresentation = isPresentationFile(originalFileName, upload.mime_type);
    const preconvertBufferPromise = shouldPreconvertPresentation ? fs.readFile(finalFilePath) : null;

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
        fileSize: upload.file_size,
        // 命中内容重复时回带，供前端提示；为 null 表示无重复
        duplicateOf: dupExisting
          ? { fileId: dupExisting.id, name: dupExisting.original_name }
          : null
      }
    });

    if (preconvertBufferPromise) {
      preconvertBufferPromise
        .then((buffer) => {
          preconvertPresentationInBackground({
            sourceBuffer: buffer,
            sourceExt: path.extname(originalFileName).toLowerCase(),
            fileHash,
            originalName: originalFileName
          });
        })
        .catch((error) => {
          console.warn('读取分块上传文件用于预转换失败:', error && error.message ? error.message : error);
        });
    }
  } catch (error) {
    console.error('完成上传失败:', error);
    console.error('完成上传失败 - 堆栈:', error.stack);
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
    let hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');

    if (!hasPermission && file.space_id) {
      hasPermission = await checkPermission(req.user.id, 'space', file.space_id, 'read');

      if (!hasPermission) {
        const space = await db.get('SELECT owner_id FROM spaces WHERE id = ?', [file.space_id]);
        if (space && space.owner_id === req.user.id) {
          hasPermission = true;
        }
      }
    }

    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }
    
    const resolvedPath = await resolveFilePath(file);
    if (!resolvedPath) {
      console.error('文件不存在:', file.file_path);
      return res.status(404).json({ success: false, message: '文件不存在或已被删除' });
    }

    let fileBuffer;
    try {
      fileBuffer = await fs.readFile(resolvedPath);
    } catch (error) {
      console.error('读取文件失败:', error);
      return res.status(500).json({ success: false, message: '读取文件失败: ' + error.message });
    }

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

    let mimeType = file.mime_type || 'application/octet-stream';
    const fileExt = path.extname(file.original_name || file.name || '').toLowerCase();
    if (!file.mime_type || file.mime_type === 'application/octet-stream') {
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
    const textExts = new Set(['.txt', '.md', '.markdown', '.json', '.xml', '.html', '.htm', '.css', '.js', '.log', '.csv', '.ini', '.conf', '.yml', '.yaml']);
    const isText = mimeType.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/javascript'].includes(mimeType) ||
      textExts.has(fileExt);
    const isPresentation = ['.ppt', '.pptx'].includes(fileExt);
    
    // 判断是否为 Office 文档（通过 MIME 类型或文件扩展名）
    const isOffice = mimeType.includes('word') || 
                     mimeType.includes('excel') || 
                     mimeType.includes('powerpoint') ||
                     mimeType.includes('spreadsheet') ||
                     mimeType.includes('presentation') ||
                     mimeType.includes('msword') ||
                     mimeType.includes('ms-excel') ||
                     mimeType.includes('ms-powerpoint') ||
                     ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(fileExt);
    
    // 如果是下载请求，直接返回文件
    if (download === 'true') {
      res.setHeader('Content-Type', mimeType);
      setAttachmentDisposition(res, file.original_name);
      res.setHeader('Content-Length', decryptedBuffer.length);
      res.send(decryptedBuffer);
      return;
    }
    
    // 设置响应头
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', decryptedBuffer.length);
    
    // 对于图片、PDF 和文本文件，直接返回文件内容给前端渲染
    if (isImage || isPdf || isText) {
      // 设置缓存头
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(decryptedBuffer);
      return;
    }

    // 内网场景：PPT/PPTX 优先在服务端转换成 PDF，再复用现有 PDF 预览
    if (isPresentation) {
      try {
        const conversionStatus = await getPresentationPreviewStatus({
          sourceBuffer: decryptedBuffer,
          fileHash: file.hash
        });

        if (conversionStatus.status === 'ready' && conversionStatus.pdfPath) {
          await sendPdfPreviewStream(res, conversionStatus.pdfPath);
          return;
        }

        const queued = await enqueuePresentationToPdf({
          sourceBuffer: decryptedBuffer,
          sourceExt: fileExt,
          fileHash: file.hash,
          originalName: file.original_name || file.name || `source${fileExt}`
        });

        return res.json({
          success: true,
          data: {
            fileId: file.id,
            fileName: file.original_name,
            mimeType: 'application/pdf',
            previewable: true,
            previewType: 'presentation-converting',
            conversionStatus: queued.status,
            pollIntervalMs: 2000,
            message: '正在将 PPT/PPTX 转换为 PDF，请稍候...',
            downloadUrl: `/api/files/download/${fileId}`
          }
        });
      } catch (error) {
        console.error('PPT/PPTX 转 PDF 预览失败:', error);
        return res.json({
          success: true,
          data: {
            fileId: file.id,
            fileName: file.original_name,
            mimeType: mimeType,
            previewable: false,
            message: error.message || 'PPT/PPTX 转 PDF 失败，请下载后查看',
            downloadUrl: `/api/files/download/${fileId}`
          }
        });
      }
    }
    
    // 对于Office文档，创建临时预览URL并使用在线预览服务
    if (isOffice) {
      // 生成临时预览token（有效期1小时）
      const previewToken = require('../utils/encryption').generateToken(32);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1小时后过期
      
      // 将临时token存储到数据库或内存（这里使用简单的内存存储）
      // 实际生产环境应该使用Redis或数据库
      if (!global.previewTokens) {
        global.previewTokens = new Map();
      }
      global.previewTokens.set(previewToken, {
        fileId: file.id,
        expiresAt: expiresAt.getTime()
      });
      
      // 清理过期的token（简单清理，实际应该用定时任务）
      setTimeout(() => {
        if (global.previewTokens) {
          global.previewTokens.delete(previewToken);
        }
      }, 60 * 60 * 1000);
      
      // 获取服务器地址（从请求头推断）
      const protocol = req.protocol || 'http';
      const host = req.get('host') || 'localhost:3000';
      const baseUrl = `${protocol}://${host}`;
      
      // 创建临时预览URL
      const previewUrl = `${baseUrl}/api/files/preview-public/${previewToken}`;
      
      // 返回预览信息，前端可以使用 Google Docs Viewer 或 Microsoft Office Online Viewer
      res.json({
        success: true,
        data: {
          fileId: file.id,
          fileName: file.original_name,
          mimeType: mimeType,
          previewable: true,
          previewType: 'office',
          previewUrl: previewUrl,
          // Google Docs Viewer URL
          googleDocsViewerUrl: `https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`,
          // Microsoft Office Online Viewer URL
          officeViewerUrl: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`,
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

// 公开预览URL（用于在线预览服务）
router.get('/preview-public/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // 从内存中获取token信息
    if (!global.previewTokens || !global.previewTokens.has(token)) {
      return res.status(404).json({ success: false, message: '预览链接不存在或已过期' });
    }
    
    const tokenInfo = global.previewTokens.get(token);
    
    // 检查是否过期
    if (Date.now() > tokenInfo.expiresAt) {
      global.previewTokens.delete(token);
      return res.status(403).json({ success: false, message: '预览链接已过期' });
    }
    
    const { fileId } = tokenInfo;
    
    // 获取文件信息
    const file = await db.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [fileId]);
    
    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    const resolvedPath = await resolveFilePath(file);
    if (!resolvedPath) {
      console.error('文件不存在:', file.file_path);
      return res.status(404).json({ success: false, message: '文件不存在或已被删除' });
    }

    let fileBuffer;
    try {
      fileBuffer = await fs.readFile(resolvedPath);
    } catch (error) {
      console.error('读取文件失败:', error);
      return res.status(500).json({ success: false, message: '读取文件失败: ' + error.message });
    }

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

    let mimeType = file.mime_type || 'application/octet-stream';
    if (!file.mime_type || file.mime_type === 'application/octet-stream') {
      const fileExt = path.extname(file.original_name || file.name || '').toLowerCase();
      const mimeTypes = {
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
    
    // 设置响应头
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Length', decryptedBuffer.length);
    res.setHeader('Access-Control-Allow-Origin', '*'); // 允许跨域访问（用于在线预览服务）
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    res.send(decryptedBuffer);
  } catch (error) {
    console.error('公开预览失败:', error);
    res.status(500).json({ success: false, message: '预览失败: ' + error.message });
  }
});

module.exports = router;

