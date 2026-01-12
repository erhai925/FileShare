const db = require('../config/database');

// 记录操作日志
async function logOperation(userId, action, resourceType, resourceId, details, req) {
  try {
    const ipAddress = req?.ip || req?.connection?.remoteAddress || 'unknown';
    const userAgent = req?.get('user-agent') || 'unknown';
    
    await db.run(
      `INSERT INTO operation_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, action, resourceType, resourceId, JSON.stringify(details), ipAddress, userAgent]
    );
  } catch (error) {
    console.error('记录操作日志失败:', error);
  }
}

// 清理过期日志
async function cleanOldLogs(retentionDays = 90) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const result = await db.run(
      `DELETE FROM operation_logs WHERE created_at < ?`,
      [cutoffDate.toISOString()]
    );
    
    console.log(`清理了 ${result.changes} 条过期日志`);
    return result.changes;
  } catch (error) {
    console.error('清理日志失败:', error);
    return 0;
  }
}

// 获取日志（分页）
async function getLogs(page = 1, pageSize = 50, filters = {}) {
  try {
    let sql = `SELECT 
      l.*, 
      u.username, 
      u.real_name 
    FROM operation_logs l
    LEFT JOIN users u ON l.user_id = u.id
    WHERE 1=1`;
    const params = [];
    
    if (filters.userId) {
      sql += ` AND l.user_id = ?`;
      params.push(filters.userId);
    }
    
    if (filters.action) {
      sql += ` AND l.action = ?`;
      params.push(filters.action);
    }
    
    if (filters.startDate) {
      sql += ` AND l.created_at >= ?`;
      params.push(filters.startDate);
    }
    
    if (filters.endDate) {
      sql += ` AND l.created_at <= ?`;
      params.push(filters.endDate);
    }
    
    sql += ` ORDER BY l.created_at DESC LIMIT ? OFFSET ?`;
    params.push(pageSize, (page - 1) * pageSize);
    
    const logs = await db.query(sql, params);
    
    // 获取总数
    let countSql = `SELECT COUNT(*) as total FROM operation_logs WHERE 1=1`;
    const countParams = [];
    
    if (filters.userId) {
      countSql += ` AND user_id = ?`;
      countParams.push(filters.userId);
    }
    
    if (filters.action) {
      countSql += ` AND action = ?`;
      countParams.push(filters.action);
    }
    
    const totalResult = await db.get(countSql, countParams);
    const total = totalResult?.total || 0;
    
    return {
      logs: logs.map(log => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };
  } catch (error) {
    console.error('获取日志失败:', error);
    throw error;
  }
}

module.exports = {
  logOperation,
  cleanOldLogs,
  getLogs
};





