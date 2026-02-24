const jwt = require('jsonwebtoken');
const db = require('../config/database');

// JWT认证中间件
async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ success: false, message: '未提供认证令牌' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret');
    
    // 验证用户是否存在且状态正常
    const user = await db.get('SELECT * FROM users WHERE id = ? AND status = ?', 
      [decoded.userId, 'active']);
    
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在或已被禁用' });
    }
    
    // 将用户信息附加到请求对象
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      realName: user.real_name
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: '无效的认证令牌' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: '认证令牌已过期' });
    }
    return res.status(500).json({ success: false, message: '认证验证失败' });
  }
}

// 权限检查中间件
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' });
    }
    
    if (allowedRoles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).json({ success: false, message: '权限不足' });
    }
  };
}

// 管理员权限检查
const requireAdmin = requireRole('admin');

// 检查资源权限
async function checkPermission(userId, resourceType, resourceId, permissionType) {
  try {
    // 管理员拥有所有权限
    const user = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
    if (user?.role === 'admin') {
      return true;
    }
    
    // 对于文件，检查是否是创建者（创建者默认拥有所有权限）
    if (resourceType === 'file') {
      const file = await db.get('SELECT created_by FROM files WHERE id = ?', [resourceId]);
      if (file && file.created_by === userId) {
        return true;
      }
    }
    
    // 对于空间，检查是否是所有者
    if (resourceType === 'space') {
      const space = await db.get('SELECT owner_id FROM spaces WHERE id = ?', [resourceId]);
      if (space && space.owner_id === userId) {
        return true;
      }
    }
    
    // 检查直接权限
    const directPermission = await db.get(
      `SELECT * FROM permissions 
       WHERE resource_type = ? AND resource_id = ? 
       AND user_id = ? AND permission_type = ?`,
      [resourceType, resourceId, userId, permissionType]
    );
    
    if (directPermission) {
      return true;
    }
    
    // 检查用户组权限
    const groupPermission = await db.get(
      `SELECT p.* FROM permissions p
       INNER JOIN user_group_members ugm ON p.group_id = ugm.group_id
       WHERE p.resource_type = ? AND p.resource_id = ? 
       AND ugm.user_id = ? AND p.permission_type = ?`,
      [resourceType, resourceId, userId, permissionType]
    );
    
    if (groupPermission) {
      return true;
    }
    
    // 如果没有明确的权限记录，对于文件类型，检查是否有通用的读取权限
    // 这里可以根据业务需求调整：默认允许还是默认拒绝
    // 目前采用默认拒绝策略，只有明确授权的才能访问
    
    return false;
  } catch (error) {
    console.error('权限检查失败:', error);
    return false;
  }
}

// 获取用户对资源的所有权限（用于文件列表展示操作按钮）
async function getUserPermissions(userId, resourceType, resourceId) {
  const types = ['read', 'write', 'delete', 'comment', 'download'];
  const result = {};
  for (const t of types) {
    result[t] = await checkPermission(userId, resourceType, resourceId, t);
  }
  return result;
}

// 批量获取用户对多个文件的权限（优化性能）
async function getBatchFilePermissions(userId, files) {
  const user = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
  const isAdmin = user?.role === 'admin';
  const fileIds = files.map(f => f.id).filter(Boolean);
  if (fileIds.length === 0) return {};

  const permMap = {};
  for (const f of files) {
    permMap[f.id] = { read: false, write: false, delete: false, comment: false, download: false };
  }

  if (isAdmin) {
    for (const id of fileIds) {
      permMap[id] = { read: true, write: true, delete: true, comment: true, download: true };
    }
    return permMap;
  }

  // 创建者拥有全部权限
  for (const f of files) {
    if (f.created_by === userId) {
      permMap[f.id] = { read: true, write: true, delete: true, comment: true, download: true };
    }
  }

  // 空间所有者对空间内文件有全部权限
  const spaceIds = [...new Set(files.filter(f => f.space_id).map(f => f.space_id))];
  for (const sid of spaceIds) {
    const space = await db.get('SELECT owner_id FROM spaces WHERE id = ?', [sid]);
    if (space?.owner_id === userId) {
      for (const f of files) {
        if (f.space_id === sid && !permMap[f.id].read) {
          permMap[f.id] = { read: true, write: true, delete: true, comment: true, download: true };
        }
      }
    }
  }

  // 批量查询直接权限和用户组权限
  const placeholders = fileIds.map(() => '?').join(',');
  const directPerms = await db.query(
    `SELECT resource_id, permission_type FROM permissions 
     WHERE resource_type = 'file' AND resource_id IN (${placeholders}) 
     AND user_id = ?`,
    [...fileIds, userId]
  );
  const groupPerms = await db.query(
    `SELECT p.resource_id, p.permission_type FROM permissions p
     INNER JOIN user_group_members ugm ON p.group_id = ugm.group_id
     WHERE p.resource_type = 'file' AND p.resource_id IN (${placeholders})
     AND ugm.user_id = ?`,
    [...fileIds, userId]
  );

  for (const row of [...directPerms, ...groupPerms]) {
    if (permMap[row.resource_id] && !permMap[row.resource_id][row.permission_type]) {
      permMap[row.resource_id][row.permission_type] = true;
    }
  }

  // 空间级权限：有空间权限则对空间内文件生效
  let spacePerms = [];
  if (spaceIds.length > 0) {
    spacePerms = await db.query(
      `SELECT p.resource_id, p.permission_type FROM permissions p
       WHERE p.resource_type = 'space' AND p.resource_id IN (${spaceIds.map(() => '?').join(',')})
       AND (p.user_id = ? OR p.group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?))`,
      [...spaceIds, userId, userId]
    );
  }
  const spacePermMap = {};
  for (const row of spacePerms) {
    if (!spacePermMap[row.resource_id]) spacePermMap[row.resource_id] = new Set();
    spacePermMap[row.resource_id].add(row.permission_type);
  }
  for (const f of files) {
    if (f.space_id && spacePermMap[f.space_id] && !permMap[f.id].read) {
      for (const t of ['read', 'write', 'delete', 'comment', 'download']) {
        if (spacePermMap[f.space_id].has(t)) permMap[f.id][t] = true;
      }
    }
  }

  return permMap;
}

module.exports = {
  authenticate,
  requireRole,
  requireAdmin,
  checkPermission,
  getUserPermissions,
  getBatchFilePermissions
};

