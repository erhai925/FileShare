const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const fileRoutes = require('./routes/files');
const spaceRoutes = require('./routes/spaces');
const permissionRoutes = require('./routes/permissions');
const shareRoutes = require('./routes/shares');
const commentRoutes = require('./routes/comments');
const searchRoutes = require('./routes/search');
const adminRoutes = require('./routes/admin');
const logRoutes = require('./routes/logs');

const app = express();
const PORT = process.env.PORT || 3000;

// 安全中间件
app.use(helmet());
app.use(compression());

// CORS配置
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

// 请求体解析
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 限流配置
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 限制每个IP 15分钟内最多100个请求
  message: '请求过于频繁，请稍后再试'
});
app.use('/api/', limiter);

// 静态文件服务（用于文件下载）
app.use('/api/files/download', express.static('storage'));

// 桌面客户端安装程序下载服务
app.use('/api/downloads', express.static('downloads', {
  setHeaders: (res, path) => {
    // 设置下载文件的响应头
    if (path.endsWith('.dmg') || path.endsWith('.exe') || path.endsWith('.AppImage')) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/logs', logRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('全局错误处理 - 详细错误信息:');
  console.error('请求路径:', req.path);
  console.error('请求方法:', req.method);
  console.error('错误类型:', err.constructor.name);
  console.error('错误消息:', err.message);
  console.error('错误堆栈:', err.stack);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || '服务器内部错误',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      name: err.constructor.name,
      path: req.path,
      method: req.method
    })
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// 启动服务器
async function startServer() {
  try {
    // 初始化数据库
    await db.init();
    console.log('数据库初始化成功');

    // 创建必要的目录
    const { getStoragePath, initStorageDirectories } = require('./utils/storage');
    const storagePath = await getStoragePath();
    await initStorageDirectories(storagePath);
    console.log(`存储目录创建成功: ${storagePath}`);

    app.listen(PORT, () => {
      console.log(`服务器运行在端口 ${PORT}`);
      console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;

