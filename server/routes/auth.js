const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');

const router = express.Router();

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, realName } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: '用户名、邮箱和密码不能为空' });
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
    
    // 创建用户（默认角色为viewer）
    const result = await db.run(
      `INSERT INTO users (username, email, password_hash, real_name, role)
       VALUES (?, ?, ?, ?, ?)`,
      [username, email, passwordHash, realName || null, 'viewer']
    );
    
    await logOperation(result.lastID, 'register', 'user', result.lastID, { username, email }, req);
    
    res.json({
      success: true,
      message: '注册成功',
      data: { userId: result.lastID }
    });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ success: false, message: '注册失败，请稍后重试' });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    // 查找用户
    const user = await db.get(
      'SELECT * FROM users WHERE (username = ? OR email = ?) AND status = ?',
      [username, username, 'active']
    );
    
    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    
    // 验证密码
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await logOperation(user.id, 'login_failed', 'user', user.id, { reason: 'wrong_password' }, req);
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    
    // 生成JWT Token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    
    await logOperation(user.id, 'login', 'user', user.id, {}, req);
    
    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          realName: user.real_name,
          role: user.role,
          avatar: user.avatar
        }
      }
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ success: false, message: '登录失败，请稍后重试' });
  }
});

// 获取当前用户信息
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        realName: user.real_name,
        role: user.role,
        avatar: user.avatar,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

// 修改密码
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '旧密码和新密码不能为空' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '新密码长度至少6位' });
    }
    
    // 获取当前用户
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    
    // 验证旧密码
    const isValid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: '旧密码错误' });
    }
    
    // 更新密码
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await db.run(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newPasswordHash, req.user.id]
    );
    
    await logOperation(req.user.id, 'change_password', 'user', req.user.id, {}, req);
    
    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(500).json({ success: false, message: '修改密码失败' });
  }
});

// 预留第三方登录接口（企业微信/钉钉）
router.post('/oauth/wechat-work', async (req, res) => {
  // TODO: 实现企业微信登录
  res.status(501).json({ success: false, message: '企业微信登录功能待实现' });
});

router.post('/oauth/dingtalk', async (req, res) => {
  // TODO: 实现钉钉登录
  res.status(501).json({ success: false, message: '钉钉登录功能待实现' });
});

module.exports = router;





