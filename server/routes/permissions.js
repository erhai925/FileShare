const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');

const router = express.Router();

// 设置权限（管理员或资源所有者）
router.post('/', authenticate, async (req, res) => {
  try {
    const { resourceType, resourceId, userId, groupId, permissionTypes } = req.body;
    
    if (!resourceType || !resourceId || !permissionTypes || !Array.isArray(permissionTypes)) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }
    
    if (!userId && !groupId) {
      return res.status(400).json({ success: false, message: '必须指定用户或用户组' });
    }
    
    // 检查是否为管理员或资源所有者
    if (req.user.role !== 'admin') {
      // TODO: 检查是否为资源所有者
      return res.status(403).json({ success: false, message: '无权限设置' });
    }
    
    // 删除旧权限
    if (userId) {
      await db.run(
        `DELETE FROM permissions 
         WHERE resource_type = ? AND resource_id = ? AND user_id = ?`,
        [resourceType, resourceId, userId]
      );
    } else if (groupId) {
      await db.run(
        `DELETE FROM permissions 
         WHERE resource_type = ? AND resource_id = ? AND group_id = ?`,
        [resourceType, resourceId, groupId]
      );
    }
    
    // 添加新权限
    for (const permType of permissionTypes) {
      await db.run(
        `INSERT INTO permissions (resource_type, resource_id, user_id, group_id, granted_by)
         VALUES (?, ?, ?, ?, ?)`,
        [resourceType, resourceId, userId || null, groupId || null, req.user.id]
      );
    }
    
    await logOperation(req.user.id, 'set_permission', resourceType, resourceId, {
      userId,
      groupId,
      permissionTypes
    }, req);
    
    res.json({ success: true, message: '权限设置成功' });
  } catch (error) {
    console.error('设置权限失败:', error);
    res.status(500).json({ success: false, message: '设置权限失败' });
  }
});

// 获取资源权限列表
router.get('/:resourceType/:resourceId', authenticate, async (req, res) => {
  try {
    const { resourceType, resourceId } = req.params;
    
    const permissions = await db.query(
      `SELECT p.*, 
       u.username as user_name, u.real_name as user_real_name,
       g.name as group_name,
       gb.username as granted_by_name
       FROM permissions p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN user_groups g ON p.group_id = g.id
       LEFT JOIN users gb ON p.granted_by = gb.id
       WHERE p.resource_type = ? AND p.resource_id = ?
       ORDER BY p.created_at DESC`,
      [resourceType, resourceId]
    );
    
    res.json({ success: true, data: permissions });
  } catch (error) {
    console.error('获取权限列表失败:', error);
    res.status(500).json({ success: false, message: '获取权限列表失败' });
  }
});

// 撤销权限
router.delete('/:permissionId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { permissionId } = req.params;
    
    const permission = await db.get('SELECT * FROM permissions WHERE id = ?', [permissionId]);
    if (!permission) {
      return res.status(404).json({ success: false, message: '权限不存在' });
    }
    
    await db.run('DELETE FROM permissions WHERE id = ?', [permissionId]);
    
    await logOperation(req.user.id, 'revoke_permission', permission.resource_type, permission.resource_id, {
      permissionId
    }, req);
    
    res.json({ success: true, message: '权限已撤销' });
  } catch (error) {
    console.error('撤销权限失败:', error);
    res.status(500).json({ success: false, message: '撤销权限失败' });
  }
});

module.exports = router;





