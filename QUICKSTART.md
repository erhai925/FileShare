# FileShare 快速启动指南

## 5分钟快速启动

### 1. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd client
npm install
cd ..
```

### 2. 配置环境

```bash
# 复制环境变量模板（如果.env.example存在）
# 或手动创建.env文件，配置以下关键项：
# JWT_SECRET=your-secret-key
# ENCRYPTION_KEY=your-32-char-encryption-key
```

### 3. 初始化数据库

```bash
npm run init
```

这将创建数据库和默认管理员账户：
- 用户名: `admin`
- 密码: `admin123`

### 4. 启动开发服务器

```bash
# 同时启动前后端（开发模式）
npm run dev

# 或分别启动
npm run server:dev  # 后端 (http://localhost:3000)
npm run client:dev  # 前端 (http://localhost:5173)
```

### 5. 访问系统

打开浏览器访问：`http://localhost:5173`

使用默认管理员账号登录：
- 用户名: `admin`
- 密码: `admin123`

**⚠️ 首次登录后请立即修改密码！**

## 生产环境部署

### 构建前端

```bash
cd client
npm run build
cd ..
```

### 使用PM2运行

```bash
npm install -g pm2
pm2 start server/index.js --name fileshare
pm2 save
```

详细部署说明请参考：`docs/deployment.md`

## 功能清单

✅ **已实现功能**
- 用户认证（登录/注册/修改密码）
- 文件上传/下载（支持大文件）
- 文件管理（重命名/删除/移动）
- 空间管理（团队/部门/个人/项目空间）
- 权限控制（四级角色，文件夹级权限）
- 外部分享（密码/有效期/访问记录）
- 文件版本管理
- 文件评论（@成员提醒）
- 文件搜索（多条件组合）
- 操作日志（90天保留）
- 管理员后台（用户管理/日志查看/系统配置）
- 文件加密存储（AES-256）
- 回收站功能
- 断点续传优化（分块上传、暂停/恢复、进度显示）
- 在线预览（PDF、图片预览，Office文档提示下载）
- 桌面客户端（Electron，支持系统托盘、本地文件选择）

🚧 **待实现功能**
- 移动端APP（React Native）
- 第三方登录（企业微信/钉钉）
- 文件命名规则验证
- 自动备份任务
- Office文档在线预览（需要集成转换服务）

## 项目结构

```
FileShare/
├── server/              # 后端服务
│   ├── index.js        # 入口文件
│   ├── config/         # 配置
│   ├── routes/         # 路由
│   ├── middleware/     # 中间件
│   ├── utils/          # 工具函数
│   └── scripts/        # 脚本工具
├── client/             # 前端应用
│   ├── src/
│   │   ├── pages/      # 页面
│   │   ├── components/ # 组件
│   │   ├── services/   # API服务
│   │   └── stores/     # 状态管理
│   └── package.json
├── storage/            # 文件存储
├── data/               # 数据库
├── docs/               # 文档
└── README.md
```

## 常见问题

### Q: 端口被占用？
A: 修改 `.env` 中的 `PORT` 配置，或修改 `client/vite.config.ts` 中的端口。

### Q: 数据库初始化失败？
A: 确保 `data/` 目录有写权限，或手动创建该目录。

### Q: 文件上传失败？
A: 检查 `storage/` 目录权限，确保有写权限。

### Q: 前端无法访问后端？
A: 检查 `client/vite.config.ts` 中的代理配置。

## 技术支持

- 部署文档：`docs/deployment.md`
- 用户手册：`docs/user-manual.md`
- 项目README：`README.md`



