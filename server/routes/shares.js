const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate, checkPermission } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');
const { generateToken } = require('../utils/encryption');

const router = express.Router();

// 创建外部分享
router.post('/', authenticate, async (req, res) => {
  try {
    const { resourceType, resourceId, password, allowedEmails, expiresInDays } = req.body;
    
    if (!resourceType || !resourceId) {
      return res.status(400).json({ success: false, message: '资源类型和ID不能为空' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, resourceType, resourceId, 'read');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无分享权限' });
    }
    
    // 生成分享Token
    const shareToken = generateToken(32);
    
    // 计算过期时间
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
    }
    
    // 密码加密
    let passwordHash = null;
    if (password) {
      if (password.length < 4 || password.length > 16) {
        return res.status(400).json({ success: false, message: '密码长度必须在4-16位之间' });
      }
      passwordHash = await bcrypt.hash(password, 10);
    }
    
    const result = await db.run(
      `INSERT INTO external_shares (resource_type, resource_id, share_token, password_hash, allowed_emails, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        resourceType,
        resourceId,
        shareToken,
        passwordHash,
        allowedEmails ? JSON.stringify(allowedEmails) : null,
        expiresAt ? expiresAt.toISOString() : null,
        req.user.id
      ]
    );
    
    await logOperation(req.user.id, 'create_share', resourceType, resourceId, {
      shareId: result.lastID,
      hasPassword: !!password,
      expiresAt
    }, req);
    
    res.json({
      success: true,
      message: '分享链接创建成功',
      data: {
        shareId: result.lastID,
        shareToken,
        shareUrl: `/share/${shareToken}`,
        expiresAt
      }
    });
  } catch (error) {
    console.error('创建分享失败:', error);
    res.status(500).json({ success: false, message: '创建分享失败' });
  }
});

// 访问分享链接（验证密码）
router.post('/:shareToken/access', async (req, res) => {
  try {
    const { shareToken } = req.params;
    const { password, email } = req.body;
    
    const share = await db.get('SELECT * FROM external_shares WHERE share_token = ?', [shareToken]);
    
    if (!share) {
      return res.status(404).json({ success: false, message: '分享链接不存在' });
    }
    
    // 检查是否过期
    if (share.expires_at) {
      const expiresAt = new Date(share.expires_at);
      if (expiresAt < new Date()) {
        return res.status(403).json({ success: false, message: '分享链接已过期' });
      }
    }
    
    // 检查邮箱限制
    if (share.allowed_emails) {
      const allowedEmails = JSON.parse(share.allowed_emails);
      if (!allowedEmails.includes(email)) {
        return res.status(403).json({ success: false, message: '您的邮箱不在允许访问列表中' });
      }
    }
    
    // 验证密码
    if (share.password_hash) {
      if (!password) {
        return res.status(400).json({ success: false, message: '需要密码' });
      }
      const isValid = await bcrypt.compare(password, share.password_hash);
      if (!isValid) {
        return res.status(401).json({ success: false, message: '密码错误' });
      }
    }
    
    // 记录访问
    await db.run(
      `INSERT INTO share_access_logs (share_id, access_ip, access_email)
       VALUES (?, ?, ?)`,
      [share.id, req.ip || 'unknown', email || null]
    );
    
    // 更新访问次数
    await db.run(
      'UPDATE external_shares SET access_count = access_count + 1 WHERE id = ?',
      [share.id]
    );
    
    res.json({
      success: true,
      message: '验证成功',
      data: {
        resourceType: share.resource_type,
        resourceId: share.resource_id
      }
    });
  } catch (error) {
    console.error('访问分享失败:', error);
    res.status(500).json({ success: false, message: '访问分享失败' });
  }
});

// 获取分享列表（我创建的）
router.get('/my-shares', authenticate, async (req, res) => {
  try {
    const shares = await db.query(
      `SELECT s.*, 
       CASE 
         WHEN s.resource_type = 'file' THEN f.original_name
         WHEN s.resource_type = 'folder' THEN fo.name
       END as resource_name
       FROM external_shares s
       LEFT JOIN files f ON s.resource_type = 'file' AND s.resource_id = f.id
       LEFT JOIN folders fo ON s.resource_type = 'folder' AND s.resource_id = fo.id
       WHERE s.created_by = ?
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    
    res.json({ success: true, data: shares });
  } catch (error) {
    console.error('获取分享列表失败:', error);
    res.status(500).json({ success: false, message: '获取分享列表失败' });
  }
});

// 获取分享访问记录
router.get('/:shareId/access-logs', authenticate, async (req, res) => {
  try {
    const { shareId } = req.params;
    
    const share = await db.get('SELECT * FROM external_shares WHERE id = ?', [shareId]);
    if (!share) {
      return res.status(404).json({ success: false, message: '分享不存在' });
    }
    
    // 只有创建者可以查看访问记录
    if (share.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权限查看访问记录' });
    }
    
    const logs = await db.query(
      `SELECT * FROM share_access_logs
       WHERE share_id = ?
       ORDER BY accessed_at DESC
       LIMIT 100`,
      [shareId]
    );
    
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取访问记录失败:', error);
    res.status(500).json({ success: false, message: '获取访问记录失败' });
  }
});

// 撤销分享
router.delete('/:shareId', authenticate, async (req, res) => {
  try {
    const { shareId } = req.params;
    
    const share = await db.get('SELECT * FROM external_shares WHERE id = ?', [shareId]);
    if (!share) {
      return res.status(404).json({ success: false, message: '分享不存在' });
    }
    
    // 只有创建者或管理员可以撤销
    if (share.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权限撤销分享' });
    }
    
    await db.run('DELETE FROM external_shares WHERE id = ?', [shareId]);
    
    await logOperation(req.user.id, 'revoke_share', share.resource_type, share.resource_id, {
      shareId
    }, req);
    
    res.json({ success: true, message: '分享已撤销' });
  } catch (error) {
    console.error('撤销分享失败:', error);
    res.status(500).json({ success: false, message: '撤销分享失败' });
  }
});

module.exports = router;





