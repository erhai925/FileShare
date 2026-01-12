const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// 文件搜索
router.get('/', authenticate, async (req, res) => {
  try {
    const { keyword, fileType, startDate, endDate, uploaderId, spaceId, page = 1, pageSize = 50 } = req.query;
    
    let sql = `SELECT f.*, 
      u1.username as creator_name, u1.real_name as creator_real_name,
      s.name as space_name
      FROM files f
      LEFT JOIN users u1 ON f.created_by = u1.id
      LEFT JOIN spaces s ON f.space_id = s.id
      WHERE f.deleted_at IS NULL`;
    const params = [];
    
    // 关键词搜索（文件名）
    if (keyword) {
      sql += ` AND (f.name LIKE ? OR f.original_name LIKE ?)`;
      const keywordPattern = `%${keyword}%`;
      params.push(keywordPattern, keywordPattern);
    }
    
    // 文件类型过滤
    if (fileType) {
      sql += ` AND f.mime_type LIKE ?`;
      params.push(`%${fileType}%`);
    }
    
    // 时间范围
    if (startDate) {
      sql += ` AND f.created_at >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND f.created_at <= ?`;
      params.push(endDate);
    }
    
    // 上传人
    if (uploaderId) {
      sql += ` AND f.created_by = ?`;
      params.push(uploaderId);
    }
    
    // 空间
    if (spaceId) {
      sql += ` AND f.space_id = ?`;
      params.push(spaceId);
    }
    
    // 权限过滤（非管理员只能看到有权限的文件）
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
        )
      )`;
      params.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
    }
    
    // 排序（按相关性，这里简单按更新时间）
    sql += ` ORDER BY 
      CASE WHEN f.name LIKE ? THEN 1 ELSE 2 END,
      f.updated_at DESC
      LIMIT ? OFFSET ?`;
    params.push(keyword ? `%${keyword}%` : '', parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
    
    const files = await db.query(sql, params);
    
    // 获取总数
    let countSql = `SELECT COUNT(*) as total FROM files f WHERE f.deleted_at IS NULL`;
    const countParams = [];
    
    if (keyword) {
      countSql += ` AND (f.name LIKE ? OR f.original_name LIKE ?)`;
      const keywordPattern = `%${keyword}%`;
      countParams.push(keywordPattern, keywordPattern);
    }
    if (fileType) {
      countSql += ` AND f.mime_type LIKE ?`;
      countParams.push(`%${fileType}%`);
    }
    if (startDate) {
      countSql += ` AND f.created_at >= ?`;
      countParams.push(startDate);
    }
    if (endDate) {
      countSql += ` AND f.created_at <= ?`;
      countParams.push(endDate);
    }
    if (uploaderId) {
      countSql += ` AND f.created_by = ?`;
      countParams.push(uploaderId);
    }
    if (spaceId) {
      countSql += ` AND f.space_id = ?`;
      countParams.push(spaceId);
    }
    
    if (req.user.role !== 'admin') {
      countSql += ` AND (
        f.created_by = ? OR
        EXISTS (SELECT 1 FROM permissions p WHERE p.resource_type = 'file' AND p.resource_id = f.id AND (p.user_id = ? OR p.group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?))) OR
        EXISTS (SELECT 1 FROM permissions p WHERE p.resource_type = 'space' AND p.resource_id = f.space_id AND (p.user_id = ? OR p.group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?)))
      )`;
      countParams.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
    }
    
    const totalResult = await db.get(countSql, countParams);
    
    res.json({
      success: true,
      data: {
        files,
        total: totalResult?.total || 0,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil((totalResult?.total || 0) / parseInt(pageSize))
      }
    });
  } catch (error) {
    console.error('搜索失败:', error);
    res.status(500).json({ success: false, message: '搜索失败' });
  }
});

module.exports = router;





