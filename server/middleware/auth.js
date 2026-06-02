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

    // Wiki 页面：创建者拥有所有权限；空间所有者对空间内页面有所有权限；
    // 然后两级混合 — 先查页面级直接/组权限（覆盖），再继承知识库（空间）级权限
    if (resourceType === 'wiki_page') {
      const page = await db.get('SELECT created_by, space_id FROM wiki_pages WHERE id = ?', [resourceId]);
      if (!page) return false;
      if (page.created_by === userId) return true;
      const space = await db.get('SELECT owner_id, type, space_kind FROM spaces WHERE id = ?', [page.space_id]);
      if (space && space.owner_id === userId) return true;

      // 团队/部门知识库：全员可消费（读 / 评论 / 下载），写、删仍受控
      if (space && space.space_kind === 'wiki'
        && (space.type === 'team' || space.type === 'department')
        && ['read', 'comment', 'download'].includes(permissionType)) {
        return true;
      }

      // 页面级直接权限
      const direct = await db.get(
        `SELECT 1 FROM permissions
         WHERE resource_type = 'wiki_page' AND resource_id = ?
         AND user_id = ? AND permission_type = ?`,
        [resourceId, userId, permissionType]
      );
      if (direct) return true;

      // 页面级用户组权限
      const group = await db.get(
        `SELECT 1 FROM permissions p
         INNER JOIN user_group_members ugm ON p.group_id = ugm.group_id
         WHERE p.resource_type = 'wiki_page' AND p.resource_id = ?
         AND ugm.user_id = ? AND p.permission_type = ?`,
        [resourceId, userId, permissionType]
      );
      if (group) return true;

      // 继承知识库（空间）级权限：直接 + 用户组
      const spaceDirect = await db.get(
        `SELECT 1 FROM permissions
         WHERE resource_type = 'space' AND resource_id = ?
         AND user_id = ? AND permission_type = ?`,
        [page.space_id, userId, permissionType]
      );
      if (spaceDirect) return true;

      const spaceGroup = await db.get(
        `SELECT 1 FROM permissions p
         INNER JOIN user_group_members ugm ON p.group_id = ugm.group_id
         WHERE p.resource_type = 'space' AND p.resource_id = ?
         AND ugm.user_id = ? AND p.permission_type = ?`,
        [page.space_id, userId, permissionType]
      );
      if (spaceGroup) return true;

      return false;
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

// 批量获取 Wiki 页面权限（按页面 + 知识库两级聚合，避免 N+1）
async function getBatchWikiPermissions(userId, pages) {
  const types = ['read', 'write', 'delete', 'comment', 'download'];
  const init = () => ({ read: false, write: false, delete: false, comment: false, download: false });
  const result = {};
  if (!pages || pages.length === 0) return result;

  const user = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
  const isAdmin = user?.role === 'admin';
  for (const p of pages) result[p.id] = init();

  if (isAdmin) {
    for (const p of pages) result[p.id] = { read: true, write: true, delete: true, comment: true, download: true };
    return result;
  }

  // 创建者全权
  for (const p of pages) {
    if (p.created_by === userId) {
      result[p.id] = { read: true, write: true, delete: true, comment: true, download: true };
    }
  }

  // 空间所有者：对其拥有的空间下所有页面赋全权
  const spaceIds = [...new Set(pages.map(p => p.space_id).filter(Boolean))];
  if (spaceIds.length > 0) {
    const ownedSpaces = await db.query(
      `SELECT id FROM spaces WHERE owner_id = ? AND id IN (${spaceIds.map(() => '?').join(',')})`,
      [userId, ...spaceIds]
    );
    const ownedSet = new Set(ownedSpaces.map(s => s.id));
    for (const p of pages) {
      if (ownedSet.has(p.space_id)) {
        result[p.id] = { read: true, write: true, delete: true, comment: true, download: true };
      }
    }
  }

  // 团队/部门知识库：全员可消费（读 / 评论 / 下载）
  if (spaceIds.length > 0) {
    const openRows = await db.query(
      `SELECT id FROM spaces WHERE id IN (${spaceIds.map(() => '?').join(',')})
       AND space_kind = 'wiki' AND type IN ('team','department')`,
      spaceIds
    );
    const openSet = new Set(openRows.map(s => s.id));
    for (const p of pages) {
      if (openSet.has(p.space_id)) {
        result[p.id].read = true;
        result[p.id].comment = true;
        result[p.id].download = true;
      }
    }
  }

  // 页面级直接 + 用户组权限
  const pageIds = pages.map(p => p.id);
  if (pageIds.length > 0) {
    const ph = pageIds.map(() => '?').join(',');
    const pageDirect = await db.query(
      `SELECT resource_id, permission_type FROM permissions
       WHERE resource_type = 'wiki_page' AND resource_id IN (${ph}) AND user_id = ?`,
      [...pageIds, userId]
    );
    const pageGroup = await db.query(
      `SELECT p.resource_id, p.permission_type FROM permissions p
       INNER JOIN user_group_members ugm ON p.group_id = ugm.group_id
       WHERE p.resource_type = 'wiki_page' AND p.resource_id IN (${ph}) AND ugm.user_id = ?`,
      [...pageIds, userId]
    );
    for (const r of [...pageDirect, ...pageGroup]) {
      if (result[r.resource_id]) result[r.resource_id][r.permission_type] = true;
    }
  }

  // 知识库（空间）级权限继承
  if (spaceIds.length > 0) {
    const sh = spaceIds.map(() => '?').join(',');
    const spaceDirect = await db.query(
      `SELECT resource_id, permission_type FROM permissions
       WHERE resource_type = 'space' AND resource_id IN (${sh}) AND user_id = ?`,
      [...spaceIds, userId]
    );
    const spaceGroup = await db.query(
      `SELECT p.resource_id, p.permission_type FROM permissions p
       INNER JOIN user_group_members ugm ON p.group_id = ugm.group_id
       WHERE p.resource_type = 'space' AND p.resource_id IN (${sh}) AND ugm.user_id = ?`,
      [...spaceIds, userId]
    );
    const spacePermMap = {};
    for (const r of [...spaceDirect, ...spaceGroup]) {
      if (!spacePermMap[r.resource_id]) spacePermMap[r.resource_id] = new Set();
      spacePermMap[r.resource_id].add(r.permission_type);
    }
    for (const p of pages) {
      const perms = spacePermMap[p.space_id];
      if (perms) {
        for (const t of types) {
          if (perms.has(t)) result[p.id][t] = true;
        }
      }
    }
  }

  return result;
}

module.exports = {
  authenticate,
  requireRole,
  requireAdmin,
  checkPermission,
  getUserPermissions,
  getBatchFilePermissions,
  getBatchWikiPermissions
};

