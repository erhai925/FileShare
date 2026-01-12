const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin, checkPermission } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');

const router = express.Router();

// 创建空间
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, type, description, parentId } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ success: false, message: '空间名称和类型不能为空' });
    }
    
    // 只有管理员可以创建团队空间和部门空间
    if ((type === 'team' || type === 'department') && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '只有管理员可以创建团队空间和部门空间' });
    }
    
    const result = await db.run(
      `INSERT INTO spaces (name, type, description, owner_id, parent_id)
       VALUES (?, ?, ?, ?, ?)`,
      [name, type, description || null, req.user.id, parentId || null]
    );
    
    await logOperation(req.user.id, 'create_space', 'space', result.lastID, {
      spaceName: name,
      spaceType: type
    }, req);
    
    res.json({
      success: true,
      message: '空间创建成功',
      data: { spaceId: result.lastID }
    });
  } catch (error) {
    console.error('创建空间失败:', error);
    res.status(500).json({ success: false, message: '创建空间失败' });
  }
});

// 获取空间列表
router.get('/', authenticate, async (req, res) => {
  try {
    const { type } = req.query;
    
    let sql = `SELECT s.*, u.username as owner_name
      FROM spaces s
      LEFT JOIN users u ON s.owner_id = u.id
      WHERE 1=1`;
    const params = [];
    
    if (type) {
      sql += ` AND s.type = ?`;
      params.push(type);
    }
    
    // 非管理员只能看到自己有权限的空间
    if (req.user.role !== 'admin') {
      sql += ` AND (s.owner_id = ? OR EXISTS (
        SELECT 1 FROM permissions p 
        WHERE p.resource_type = 'space' 
        AND p.resource_id = s.id 
        AND (p.user_id = ? OR p.group_id IN (
          SELECT group_id FROM user_group_members WHERE user_id = ?
        ))
      ))`;
      params.push(req.user.id, req.user.id, req.user.id);
    }
    
    sql += ` ORDER BY s.created_at DESC`;
    
    const spaces = await db.query(sql, params);
    
    res.json({ success: true, data: spaces });
  } catch (error) {
    console.error('获取空间列表失败:', error);
    res.status(500).json({ success: false, message: '获取空间列表失败' });
  }
});

// 获取空间详情
router.get('/:spaceId', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    const space = await db.get(
      `SELECT s.*, u.username as owner_name, u.real_name as owner_real_name
       FROM spaces s
       LEFT JOIN users u ON s.owner_id = u.id
       WHERE s.id = ?`,
      [spaceId]
    );
    
    if (!space) {
      return res.status(404).json({ success: false, message: '空间不存在' });
    }
    
    // 检查权限
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'read');
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: '无访问权限' });
      }
    }
    
    // 获取空间下的文件夹
    const folders = await db.query(
      `SELECT f.*, u.username as creator_name
       FROM folders f
       LEFT JOIN users u ON f.created_by = u.id
       WHERE f.space_id = ? AND f.parent_id IS NULL
       ORDER BY f.created_at ASC`,
      [spaceId]
    );
    
    // 获取空间下的文件
    let filesSql = `SELECT f.*, 
      u1.username as creator_name, 
      u2.username as updater_name
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN users u2 ON f.updated_by = u2.id
      WHERE f.deleted_at IS NULL AND f.space_id = ?`;
    const filesParams = [spaceId];
    
    // 非管理员只能看到有权限的文件
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      filesSql += ` AND (f.created_by = ? OR EXISTS (
        SELECT 1 FROM permissions p
        WHERE p.resource_type = 'file'
        AND p.resource_id = f.id
        AND (p.user_id = ? OR p.group_id IN (
          SELECT group_id FROM user_group_members WHERE user_id = ?
        ))
      ))`;
      filesParams.push(req.user.id, req.user.id, req.user.id);
    }
    
    filesSql += ` ORDER BY f.updated_at DESC LIMIT 50`;
    const files = await db.query(filesSql, filesParams);
    
    res.json({
      success: true,
      data: {
        ...space,
        folders,
        files
      }
    });
  } catch (error) {
    console.error('获取空间详情失败:', error);
    res.status(500).json({ success: false, message: '获取空间详情失败' });
  }
});

// 更新空间信息
router.put('/:spaceId', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { name, description } = req.body;
    
    // 检查空间是否存在
    const space = await db.get('SELECT * FROM spaces WHERE id = ?', [spaceId]);
    if (!space) {
      return res.status(404).json({ success: false, message: '空间不存在' });
    }
    
    // 检查权限：只有空间所有者或管理员可以修改
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权限修改空间' });
    }
    
    // 验证名称
    if (name && (name.length < 2 || name.length > 50)) {
      return res.status(400).json({ success: false, message: '空间名称长度应在2-50个字符之间' });
    }
    
    // 更新空间信息
    const updateFields = [];
    const updateValues = [];
    
    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    
    if (description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(description);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(spaceId);
    
    await db.run(
      `UPDATE spaces SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    await logOperation(req.user.id, 'update_space', 'space', spaceId, {
      updatedFields: updateFields.filter(f => !f.includes('updated_at'))
    }, req);
    
    res.json({
      success: true,
      message: '空间信息更新成功'
    });
  } catch (error) {
    console.error('更新空间信息失败:', error);
    res.status(500).json({ success: false, message: '更新空间信息失败' });
  }
});

// 添加空间成员
router.post('/:spaceId/members', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { userIds, permissionTypes } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要添加的成员' });
    }
    
    if (!permissionTypes || !Array.isArray(permissionTypes) || permissionTypes.length === 0) {
      return res.status(400).json({ success: false, message: '请选择权限类型' });
    }
    
    // 检查空间是否存在
    const space = await db.get('SELECT * FROM spaces WHERE id = ?', [spaceId]);
    if (!space) {
      return res.status(404).json({ success: false, message: '空间不存在' });
    }
    
    // 检查权限：只有空间所有者或管理员可以添加成员
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权限添加成员' });
    }
    
    // 为每个用户添加权限
    let addedCount = 0;
    for (const userId of userIds) {
      // 检查用户是否存在
      const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) {
        continue;
      }
      
      // 删除该用户在该空间的旧权限
      await db.run(
        'DELETE FROM permissions WHERE resource_type = ? AND resource_id = ? AND user_id = ?',
        ['space', spaceId, userId]
      );
      
      // 添加新权限
      for (const permType of permissionTypes) {
        await db.run(
          `INSERT INTO permissions (resource_type, resource_id, user_id, permission_type, granted_by)
           VALUES (?, ?, ?, ?, ?)`,
          ['space', spaceId, userId, permType, req.user.id]
        );
      }
      addedCount++;
    }
    
    await logOperation(req.user.id, 'add_space_members', 'space', spaceId, {
      userIds,
      permissionTypes,
      addedCount
    }, req);
    
    res.json({
      success: true,
      message: `成功添加 ${addedCount} 个成员`,
      data: { addedCount }
    });
  } catch (error) {
    console.error('添加空间成员失败:', error);
    res.status(500).json({ success: false, message: '添加空间成员失败' });
  }
});

// 获取空间成员列表
router.get('/:spaceId/members', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    // 检查空间是否存在
    const space = await db.get('SELECT * FROM spaces WHERE id = ?', [spaceId]);
    if (!space) {
      return res.status(404).json({ success: false, message: '空间不存在' });
    }
    
    // 检查权限
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'read');
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: '无访问权限' });
      }
    }
    
    // 获取空间所有者
    const owner = await db.get(
      `SELECT id, username, email, real_name, role, avatar
       FROM users WHERE id = ?`,
      [space.owner_id]
    );
    
    // 获取有权限的成员（通过permissions表）
    const members = await db.query(
      `SELECT DISTINCT u.id, u.username, u.email, u.real_name, u.role, u.avatar,
              GROUP_CONCAT(p.permission_type) as permissions
       FROM permissions p
       INNER JOIN users u ON p.user_id = u.id
       WHERE p.resource_type = 'space' AND p.resource_id = ?
       GROUP BY u.id`,
      [spaceId]
    );
    
    // 处理权限字符串
    const membersWithPermissions = members.map(member => ({
      ...member,
      permissions: member.permissions ? member.permissions.split(',') : []
    }));
    
    res.json({
      success: true,
      data: {
        owner,
        members: membersWithPermissions
      }
    });
  } catch (error) {
    console.error('获取空间成员失败:', error);
    res.status(500).json({ success: false, message: '获取空间成员失败' });
  }
});

// 移除空间成员
router.delete('/:spaceId/members/:userId', authenticate, async (req, res) => {
  try {
    const { spaceId, userId } = req.params;
    
    // 检查空间是否存在
    const space = await db.get('SELECT * FROM spaces WHERE id = ?', [spaceId]);
    if (!space) {
      return res.status(404).json({ success: false, message: '空间不存在' });
    }
    
    // 检查权限：只有空间所有者或管理员可以移除成员
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权限移除成员' });
    }
    
    // 不能移除空间所有者
    if (space.owner_id === parseInt(userId)) {
      return res.status(400).json({ success: false, message: '不能移除空间所有者' });
    }
    
    // 删除该用户在该空间的所有权限
    const result = await db.run(
      'DELETE FROM permissions WHERE resource_type = ? AND resource_id = ? AND user_id = ?',
      ['space', spaceId, userId]
    );
    
    await logOperation(req.user.id, 'remove_space_member', 'space', spaceId, {
      removedUserId: userId
    }, req);
    
    res.json({
      success: true,
      message: '成员已移除'
    });
  } catch (error) {
    console.error('移除空间成员失败:', error);
    res.status(500).json({ success: false, message: '移除空间成员失败' });
  }
});

// 获取空间下的文件夹列表（树形结构）
router.get('/:spaceId/folders', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    // 检查空间是否存在
    const space = await db.get('SELECT * FROM spaces WHERE id = ?', [spaceId]);
    if (!space) {
      return res.status(404).json({ success: false, message: '空间不存在' });
    }
    
    // 检查权限
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'read');
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: '无访问权限' });
      }
    }
    
    // 获取所有文件夹
    const folders = await db.query(
      `SELECT f.*, u.username as creator_name,
       (SELECT COUNT(*) FROM files WHERE folder_id = f.id AND deleted_at IS NULL) as file_count
       FROM folders f
       LEFT JOIN users u ON f.created_by = u.id
       WHERE f.space_id = ?
       ORDER BY f.path ASC`,
      [spaceId]
    );
    
    // 构建树形结构
    const folderMap = new Map();
    const rootFolders = [];
    
    folders.forEach(folder => {
      folder.children = [];
      folderMap.set(folder.id, folder);
    });
    
    folders.forEach(folder => {
      if (folder.parent_id) {
        const parent = folderMap.get(folder.parent_id);
        if (parent) {
          parent.children.push(folder);
        } else {
          rootFolders.push(folder);
        }
      } else {
        rootFolders.push(folder);
      }
    });
    
    res.json({
      success: true,
      data: rootFolders
    });
  } catch (error) {
    console.error('获取文件夹列表失败:', error);
    res.status(500).json({ success: false, message: '获取文件夹列表失败' });
  }
});

// 创建文件夹
router.post('/:spaceId/folders', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { name, parentId } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: '文件夹名称不能为空' });
    }
    
    // 检查空间是否存在
    const space = await db.get('SELECT * FROM spaces WHERE id = ?', [spaceId]);
    if (!space) {
      return res.status(404).json({ success: false, message: '空间不存在' });
    }
    
    // 检查空间权限
    const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'write');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无创建文件夹权限' });
    }
    
    // 如果指定了父文件夹，检查父文件夹是否属于该空间
    if (parentId) {
      const parent = await db.get('SELECT * FROM folders WHERE id = ? AND space_id = ?', [parentId, spaceId]);
      if (!parent) {
        return res.status(400).json({ success: false, message: '父文件夹不存在或不属于该空间' });
      }
    }
    
    // 检查同级文件夹名称是否重复
    const existingFolder = await db.get(
      'SELECT * FROM folders WHERE space_id = ? AND parent_id = ? AND name = ?',
      [spaceId, parentId || null, name.trim()]
    );
    if (existingFolder) {
      return res.status(400).json({ success: false, message: '该位置已存在同名文件夹' });
    }
    
    // 构建路径
    let path = name.trim();
    if (parentId) {
      const parent = await db.get('SELECT path FROM folders WHERE id = ?', [parentId]);
      if (parent) {
        path = `${parent.path}/${name.trim()}`;
      }
    }
    
    const result = await db.run(
      `INSERT INTO folders (name, space_id, parent_id, path, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), spaceId, parentId || null, path, req.user.id]
    );
    
    await logOperation(req.user.id, 'create_folder', 'folder', result.lastID, {
      folderName: name.trim(),
      spaceId,
      parentId: parentId || null
    }, req);
    
    res.json({
      success: true,
      message: '文件夹创建成功',
      data: { folderId: result.lastID }
    });
  } catch (error) {
    console.error('创建文件夹失败:', error);
    res.status(500).json({ success: false, message: '创建文件夹失败' });
  }
});

// 更新文件夹（重命名）
router.put('/:spaceId/folders/:folderId', authenticate, async (req, res) => {
  try {
    const { spaceId, folderId } = req.params;
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: '文件夹名称不能为空' });
    }
    
    // 检查文件夹是否存在
    const folder = await db.get('SELECT * FROM folders WHERE id = ? AND space_id = ?', [folderId, spaceId]);
    if (!folder) {
      return res.status(404).json({ success: false, message: '文件夹不存在' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'write');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无修改文件夹权限' });
    }
    
    // 检查同级文件夹名称是否重复
    const existingFolder = await db.get(
      'SELECT * FROM folders WHERE space_id = ? AND parent_id = ? AND name = ? AND id != ?',
      [spaceId, folder.parent_id, name.trim(), folderId]
    );
    if (existingFolder) {
      return res.status(400).json({ success: false, message: '该位置已存在同名文件夹' });
    }
    
    // 更新文件夹名称和路径
    const oldPath = folder.path;
    const newPath = folder.parent_id 
      ? (await db.get('SELECT path FROM folders WHERE id = ?', [folder.parent_id])).path + '/' + name.trim()
      : name.trim();
    
    await db.run(
      'UPDATE folders SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name.trim(), newPath, folderId]
    );
    
    // 更新所有子文件夹的路径
    const childFolders = await db.query('SELECT * FROM folders WHERE path LIKE ?', [`${oldPath}/%`]);
    for (const child of childFolders) {
      const newChildPath = child.path.replace(oldPath, newPath);
      await db.run('UPDATE folders SET path = ? WHERE id = ?', [newChildPath, child.id]);
    }
    
    await logOperation(req.user.id, 'rename_folder', 'folder', folderId, {
      oldName: folder.name,
      newName: name.trim(),
      spaceId
    }, req);
    
    res.json({
      success: true,
      message: '文件夹重命名成功'
    });
  } catch (error) {
    console.error('重命名文件夹失败:', error);
    res.status(500).json({ success: false, message: '重命名文件夹失败' });
  }
});

// 删除文件夹
router.delete('/:spaceId/folders/:folderId', authenticate, async (req, res) => {
  try {
    const { spaceId, folderId } = req.params;
    
    // 检查文件夹是否存在
    const folder = await db.get('SELECT * FROM folders WHERE id = ? AND space_id = ?', [folderId, spaceId]);
    if (!folder) {
      return res.status(404).json({ success: false, message: '文件夹不存在' });
    }
    
    // 检查权限
    const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'delete');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无删除文件夹权限' });
    }
    
    // 检查文件夹中是否有文件
    const fileCount = await db.get(
      'SELECT COUNT(*) as count FROM files WHERE folder_id = ? AND deleted_at IS NULL',
      [folderId]
    );
    if (fileCount.count > 0) {
      return res.status(400).json({ success: false, message: '文件夹中还有文件，请先删除或移动文件' });
    }
    
    // 检查是否有子文件夹
    const childCount = await db.get(
      'SELECT COUNT(*) as count FROM folders WHERE parent_id = ?',
      [folderId]
    );
    if (childCount.count > 0) {
      return res.status(400).json({ success: false, message: '文件夹中还有子文件夹，请先删除子文件夹' });
    }
    
    // 删除文件夹
    await db.run('DELETE FROM folders WHERE id = ?', [folderId]);
    
    await logOperation(req.user.id, 'delete_folder', 'folder', folderId, {
      folderName: folder.name,
      spaceId
    }, req);
    
    res.json({
      success: true,
      message: '文件夹删除成功'
    });
  } catch (error) {
    console.error('删除文件夹失败:', error);
    res.status(500).json({ success: false, message: '删除文件夹失败' });
  }
});

// 获取文件夹中的文件
router.get('/:spaceId/folders/:folderId/files', authenticate, async (req, res) => {
  try {
    const { spaceId, folderId } = req.params;
    
    // 检查文件夹是否存在
    const folder = await db.get('SELECT * FROM folders WHERE id = ? AND space_id = ?', [folderId, spaceId]);
    if (!folder) {
      return res.status(404).json({ success: false, message: '文件夹不存在' });
    }
    
    // 检查权限
    const space = await db.get('SELECT * FROM spaces WHERE id = ?', [spaceId]);
    if (req.user.role !== 'admin' && space.owner_id !== req.user.id) {
      const hasPermission = await checkPermission(req.user.id, 'space', spaceId, 'read');
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: '无访问权限' });
      }
    }
    
    // 获取文件夹中的文件
    let sql = `SELECT f.*, 
      u1.username as creator_name, 
      u2.username as updater_name
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN users u2 ON f.updated_by = u2.id
      WHERE f.deleted_at IS NULL AND f.folder_id = ?`;
    const params = [folderId];
    
    // 非管理员只能看到有权限的文件
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
    
    sql += ` ORDER BY f.updated_at DESC`;
    const files = await db.query(sql, params);
    
    res.json({
      success: true,
      data: files
    });
  } catch (error) {
    console.error('获取文件夹文件失败:', error);
    res.status(500).json({ success: false, message: '获取文件夹文件失败' });
  }
});

module.exports = router;

