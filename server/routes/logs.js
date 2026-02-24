const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getLogs, cleanOldLogs } = require('../utils/logger');

const router = express.Router();

// 获取操作日志
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, pageSize = 50, userId, action, startDate, endDate } = req.query;
    
    const result = await getLogs(parseInt(page), parseInt(pageSize), {
      userId: userId ? parseInt(userId) : null,
      action,
      startDate,
      endDate
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('获取日志失败:', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

// 导出日志
router.get('/export', authenticate, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const filters = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    // 获取所有符合条件的日志（不分页）
    const result = await getLogs(1, 10000, filters);
    
    // 转换为CSV格式
    const csvHeader = 'ID,用户,操作,资源类型,资源ID,详情,IP地址,时间\n';
    const csvRows = result.logs.map(log => {
      const details = log.details ? JSON.stringify(log.details).replace(/"/g, '""') : '';
      return `${log.id},"${log.username || ''}","${log.action}","${log.resource_type || ''}","${log.resource_id || ''}","${details}","${log.ip_address || ''}","${log.created_at}"`;
    }).join('\n');
    
    const csv = csvHeader + csvRows;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=logs-${Date.now()}.csv`);
    res.send('\ufeff' + csv); // 添加BOM以支持Excel正确显示中文
  } catch (error) {
    console.error('导出日志失败:', error);
    res.status(500).json({ success: false, message: '导出日志失败' });
  }
});

// 清理过期日志
router.post('/cleanup', authenticate, requireAdmin, async (req, res) => {
  try {
    const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || 90;
    const deletedCount = await cleanOldLogs(retentionDays);
    
    res.json({
      success: true,
      message: `已清理 ${deletedCount} 条过期日志`
    });
  } catch (error) {
    console.error('清理日志失败:', error);
    res.status(500).json({ success: false, message: '清理日志失败' });
  }
});

module.exports = router;





