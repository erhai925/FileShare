const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// 强制东八区北京时间（覆盖 .env 中的 TZ，保证日志、定时逻辑等与展示一致；库内存 UTC，前端按东八区显示）
process.env.TZ = 'Asia/Shanghai';

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

// 信任代理（Nginx 等反向代理场景下，从 X-Forwarded-For 获取真实客户端 IP，否则限流会误伤所有用户）
app.set('trust proxy', 1);

// 安全中间件
app.use(helmet());
app.use(compression());

// CORS配置 - 支持 localhost、ip:port 等多种访问方式
const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(u => u.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // 同源或非浏览器请求
    if (clientUrls.includes('*') || process.env.NODE_ENV === 'production') return callback(null, true); // 生产环境兼容 ip:port
    const allowed = clientUrls.some(url => origin === url.trim() || origin.startsWith(url.trim().replace(/\/$/, '')));
    callback(null, allowed);
  },
  credentials: true
}));

// 请求体解析（需支持大文件上传，与 MAX_FILE_SIZE 10GB 对齐；超大 JSON 由业务校验）
const bodyLimit = process.env.BODY_SIZE_LIMIT || '500mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// 限流配置（上传接口单独排除，避免大文件上传失败重试时触发限流导致用户被误判）
// 注意：限流仅返回 429，不执行任何业务逻辑，绝不修改用户密码或凭证
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000, // 限制每个IP 15分钟内最多1000个请求
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/files/upload') // 上传相关接口不参与限流计数
});
app.use('/api/', limiter);

// 文件下载走 /api/files 路由（鉴权 + 解密），不在此做静态映射

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
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: require('../upgrades/version.json').currentVersion });
});

// 系统版本（工作台展示，与 health 分离便于单独调用）
app.get('/api/version', (req, res) => {
  try {
    const v = require('../upgrades/version.json').currentVersion;
    res.json({ success: true, version: v });
  } catch (e) {
    res.json({ success: false, version: '0.0.0' });
  }
});

// 生产环境：托管前端静态文件（支持 ip:port 部署）
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  const fs = require('fs');
  if (fs.existsSync(clientDist)) {
    // 静态资源（JS/CSS 带 hash）可缓存，index.html 禁止缓存以确保升级后用户获取新版本
    app.use(express.static(clientDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get('*', (req, res, next) => {
      if (!req.path.startsWith('/api')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(path.join(clientDist, 'index.html'));
      } else {
        next();
      }
    });
  }
}

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

    const server = app.listen(PORT, () => {
      console.log(`服务器运行在端口 ${PORT}`);
      console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
    });
    // 大文件上传超时（无 Nginx 时 Node 默认约 5 分钟，75MB 慢速网络可能超时）
    const uploadTimeout = parseInt(process.env.UPLOAD_TIMEOUT_MS) || 600000; // 默认 10 分钟
    server.requestTimeout = uploadTimeout;
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;

