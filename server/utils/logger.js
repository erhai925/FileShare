/**
 * 操作日志：写入 operation_logs 表。
 * - IP：优先从 X-Forwarded-For、X-Real-IP 取客户端（浏览器）IP，再 fallback 到 req.ip / socket.remoteAddress。
 *   若前面有 Nginx 等反向代理，需在代理中配置转发：proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Real-IP $remote_addr;
 * - 时间：统一使用东八区北京时间（Asia/Shanghai），格式 YYYY-MM-DD HH:mm:ss，便于后台展示与过期清理比较。
 */
const db = require('../config/database');

// 东八区北京时间：格式 YYYY-MM-DD HH:mm:ss（与 SQLite 兼容，便于展示与比较）
function getBeijingTimeString() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

// 规范化 IP 字符串（IPv6 映射的 IPv4 如 ::ffff:192.168.1.1 转为 192.168.1.1）
function normalizeIp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s === 'unknown') return null;
  if (s.startsWith('::ffff:')) return s.slice(7);
  return s;
}

// 从请求中解析客户端（浏览器）IP，优先从代理转发的请求头读取
function getClientIp(req) {
  if (!req) return 'unknown';
  // 1) X-Forwarded-For：标准头，逗号分隔，第一段为真实客户端 IP（代理会追加自己的 IP）
  const xff = req.get?.('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    const normalized = normalizeIp(first);
    if (normalized) return normalized;
  }
  // 2) X-Real-IP：常见于 Nginx 等，直接为客户端 IP
  const xri = req.get?.('x-real-ip');
  if (xri) {
    const normalized = normalizeIp(xri);
    if (normalized) return normalized;
  }
  // 3) Express 在 trust proxy 下会从上述头解析出 req.ip
  const fromReqIp = normalizeIp(req.ip);
  if (fromReqIp) return fromReqIp;
  // 4) 直连时的 TCP 对端地址（无代理时即为浏览器所在机器）
  const raw = req.socket?.remoteAddress || req.connection?.remoteAddress;
  const normalized = normalizeIp(raw);
  return normalized || 'unknown';
}

// 记录操作日志
async function logOperation(userId, action, resourceType, resourceId, details, req) {
  try {
    const ipAddress = getClientIp(req);
    const userAgent = req?.get?.('user-agent') || 'unknown';
    const created_at = getBeijingTimeString();

    await db.run(
      `INSERT INTO operation_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, action, resourceType, resourceId, JSON.stringify(details), ipAddress, userAgent, created_at]
    );
  } catch (error) {
    console.error('记录操作日志失败:', error);
  }
}

// 清理过期日志（created_at 为东八区时间 YYYY-MM-DD HH:mm:ss， cutoff 使用同一时区与格式）
async function cleanOldLogs(retentionDays = 90) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffStr = cutoffDate.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });

    const result = await db.run(
      `DELETE FROM operation_logs WHERE created_at < ?`,
      [cutoffStr]
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





