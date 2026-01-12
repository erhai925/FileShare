const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');

const router = express.Router();

// 创建新用户（管理员）
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, email, password, realName, role, status } = req.body;
    
    // 验证必填字段
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: '用户名、邮箱和密码不能为空' });
    }
    
    // 验证密码长度
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '密码长度至少6位' });
    }
    
    // 验证角色
    const validRoles = ['admin', 'editor', 'viewer', 'commenter'];
    const userRole = role || 'viewer';
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
    }
    
    // 验证状态
    const userStatus = status || 'active';
    if (!['active', 'disabled'].includes(userStatus)) {
      return res.status(400).json({ success: false, message: '无效的状态' });
    }
    
    // 检查用户名和邮箱是否已存在
    const existingUser = await db.get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email]
    );
    
    if (existingUser) {
      return res.status(400).json({ success: false, message: '用户名或邮箱已存在' });
    }
    
    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10);
    
    // 创建用户
    const result = await db.run(
      `INSERT INTO users (username, email, password_hash, real_name, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, realName || null, userRole, userStatus]
    );
    
    await logOperation(req.user.id, 'create_user', 'user', result.lastID, {
      username,
      email,
      role: userRole,
      status: userStatus
    }, req);
    
    res.json({
      success: true,
      message: '用户创建成功',
      data: {
        userId: result.lastID,
        username,
        email,
        role: userRole,
        status: userStatus
      }
    });
  } catch (error) {
    console.error('创建用户失败:', error);
    res.status(500).json({ success: false, message: '创建用户失败: ' + error.message });
  }
});

// 获取用户列表（管理员）
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, pageSize = 50, keyword } = req.query;
    
    let sql = `SELECT id, username, email, real_name, role, status, created_at
      FROM users WHERE 1=1`;
    const params = [];
    
    if (keyword) {
      sql += ` AND (username LIKE ? OR email LIKE ? OR real_name LIKE ?)`;
      const keywordPattern = `%${keyword}%`;
      params.push(keywordPattern, keywordPattern, keywordPattern);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
    
    const users = await db.query(sql, params);
    
    // 获取总数
    let countSql = `SELECT COUNT(*) as total FROM users WHERE 1=1`;
    const countParams = [];
    if (keyword) {
      countSql += ` AND (username LIKE ? OR email LIKE ? OR real_name LIKE ?)`;
      const keywordPattern = `%${keyword}%`;
      countParams.push(keywordPattern, keywordPattern, keywordPattern);
    }
    const totalResult = await db.get(countSql, countParams);
    
    res.json({
      success: true,
      data: {
        users,
        total: totalResult?.total || 0,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

// 更新用户信息（管理员）
router.patch('/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, status, realName } = req.body;
    
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const updates = [];
    const params = [];
    
    if (role) {
      updates.push('role = ?');
      params.push(role);
    }
    
    if (status) {
      updates.push('status = ?');
      params.push(status);
    }
    
    if (realName !== undefined) {
      updates.push('real_name = ?');
      params.push(realName);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(userId);
    
    await db.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    await logOperation(req.user.id, 'update_user', 'user', userId, {
      role,
      status,
      realName
    }, req);
    
    res.json({ success: true, message: '用户信息更新成功' });
  } catch (error) {
    console.error('更新用户信息失败:', error);
    res.status(500).json({ success: false, message: '更新用户信息失败' });
  }
});

// 禁用/启用用户（管理员）
router.post('/:userId/toggle-status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: '不能禁用自己' });
    }
    
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    
    await db.run(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newStatus, userId]
    );
    
    await logOperation(req.user.id, 'toggle_user_status', 'user', userId, {
      oldStatus: user.status,
      newStatus
    }, req);
    
    res.json({ success: true, message: `用户已${newStatus === 'active' ? '启用' : '禁用'}` });
  } catch (error) {
    console.error('切换用户状态失败:', error);
    res.status(500).json({ success: false, message: '切换用户状态失败' });
  }
});

// 快速撤销用户所有权限（离职处理）
router.post('/:userId/revoke-all-permissions', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await db.run(
      'DELETE FROM permissions WHERE user_id = ?',
      [userId]
    );
    
    // 同时从所有用户组中移除
    await db.run(
      'DELETE FROM user_group_members WHERE user_id = ?',
      [userId]
    );
    
    await logOperation(req.user.id, 'revoke_all_permissions', 'user', userId, {
      permissionsRevoked: result.changes
    }, req);
    
    res.json({ success: true, message: '已撤销用户所有权限' });
  } catch (error) {
    console.error('撤销权限失败:', error);
    res.status(500).json({ success: false, message: '撤销权限失败' });
  }
});

module.exports = router;

