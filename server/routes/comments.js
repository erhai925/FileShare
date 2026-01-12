const express = require('express');
const db = require('../config/database');
const { authenticate, checkPermission } = require('../middleware/auth');
const { logOperation } = require('../utils/logger');

const router = express.Router();

// 添加评论
router.post('/', authenticate, async (req, res) => {
  try {
    const { fileId, content, mentionedUsers, parentId } = req.body;
    
    if (!fileId || !content) {
      return res.status(400).json({ success: false, message: '文件ID和评论内容不能为空' });
    }
    
    // 检查权限（至少需要comment权限）
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'comment');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无评论权限' });
    }
    
    const result = await db.run(
      `INSERT INTO comments (file_id, user_id, content, mentioned_users, parent_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        fileId,
        req.user.id,
        content,
        mentionedUsers ? JSON.stringify(mentionedUsers) : null,
        parentId || null
      ]
    );
    
    await logOperation(req.user.id, 'add_comment', 'file', fileId, {
      commentId: result.lastID
    }, req);
    
    res.json({
      success: true,
      message: '评论添加成功',
      data: { commentId: result.lastID }
    });
  } catch (error) {
    console.error('添加评论失败:', error);
    res.status(500).json({ success: false, message: '添加评论失败' });
  }
});

// 获取文件评论列表
router.get('/file/:fileId', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // 检查文件访问权限
    const hasPermission = await checkPermission(req.user.id, 'file', fileId, 'read');
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: '无访问权限' });
    }
    
    const comments = await db.query(
      `SELECT c.*, 
       u.username, u.real_name, u.avatar
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.file_id = ?
       ORDER BY c.created_at ASC`,
      [fileId]
    );
    
    // 解析mentioned_users
    const commentsWithMentions = comments.map(comment => ({
      ...comment,
      mentioned_users: comment.mentioned_users ? JSON.parse(comment.mentioned_users) : null
    }));
    
    res.json({ success: true, data: commentsWithMentions });
  } catch (error) {
    console.error('获取评论列表失败:', error);
    res.status(500).json({ success: false, message: '获取评论列表失败' });
  }
});

// 删除评论
router.delete('/:commentId', authenticate, async (req, res) => {
  try {
    const { commentId } = req.params;
    
    const comment = await db.get('SELECT * FROM comments WHERE id = ?', [commentId]);
    if (!comment) {
      return res.status(404).json({ success: false, message: '评论不存在' });
    }
    
    // 只能删除自己的评论或管理员
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权限删除此评论' });
    }
    
    await db.run('DELETE FROM comments WHERE id = ?', [commentId]);
    
    await logOperation(req.user.id, 'delete_comment', 'comment', commentId, {
      fileId: comment.file_id
    }, req);
    
    res.json({ success: true, message: '评论已删除' });
  } catch (error) {
    console.error('删除评论失败:', error);
    res.status(500).json({ success: false, message: '删除评论失败' });
  }
});

module.exports = router;





