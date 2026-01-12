# FileShare 文件共享系统

适配10-50人小团队的文件共享系统，支持私有服务器部署，实现文件集中管理、精准权限控制、多端访问。

## 核心特性

- ✅ **私有部署**：支持Linux（CentOS/Ubuntu）和Windows Server，无公有云依赖
- ✅ **多端访问**：网页端、桌面客户端（Windows/Mac）、移动端（iOS/Android）
- ✅ **分层空间**：团队公共空间、部门空间、个人空间、项目专属空间
- ✅ **精准权限**：四级角色权限（管理员/编辑者/查看者/仅评论者），文件夹级权限控制
- ✅ **版本管理**：自动保存历史版本，支持一键恢复
- ✅ **安全加密**：HTTPS传输、SM4国密算法存储加密，支持外部SDK扩展
- ✅ **操作审计**：详细操作日志，保留90天可导出
- ✅ **高性能**：支持30+人同时在线，低资源占用

## 快速开始

### 环境要求

- Node.js >= 16.0.0
- npm >= 8.0.0
- SQLite3（已包含在依赖中）

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd FileShare
```

2. **安装依赖**
```bash
npm install
cd client && npm install && cd ..
```

3. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，修改JWT_SECRET和ENCRYPTION_KEY
```

4. **初始化数据库**
```bash
npm run init
```

5. **启动服务**
```bash
# 开发模式（同时启动前后端）
npm run dev

# 或分别启动
npm run server:dev  # 后端
npm run client:dev  # 前端
```

6. **访问系统**
- 前端：http://localhost:5173
- 后端API：http://localhost:3000
- 默认管理员账号：admin / admin123（首次登录后请修改密码）

## 项目结构

```
FileShare/
├── server/              # 后端服务
│   ├── index.js        # 入口文件
│   ├── config/         # 配置文件
│   ├── models/         # 数据模型
│   ├── routes/         # 路由
│   ├── middleware/     # 中间件
│   ├── services/       # 业务逻辑
│   ├── utils/          # 工具函数
│   └── scripts/        # 脚本工具
├── client/             # 前端应用（React）
│   ├── src/
│   │   ├── components/ # 组件
│   │   ├── pages/      # 页面
│   │   ├── services/   # API服务
│   │   └── utils/      # 工具
│   └── package.json
├── storage/            # 文件存储目录
├── data/               # 数据库文件
└── docs/               # 文档
```

## 部署指南

### Linux部署

1. **安装Node.js**
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

2. **配置生产环境**
```bash
# 修改.env
NODE_ENV=production
PORT=3000

# 配置HTTPS（推荐使用Nginx反向代理）
```

3. **使用PM2运行**
```bash
npm install -g pm2
pm2 start server/index.js --name fileshare
pm2 save
pm2 startup
```

### Windows Server部署

1. 安装Node.js（从官网下载安装包）
2. 配置环境变量
3. 使用Windows服务或任务计划程序运行

详细部署文档请参考 `docs/deployment.md`

## 功能模块

### 1. 用户认证
- 账号密码登录
- JWT Token认证
- 预留第三方登录接口（企业微信/钉钉）

### 2. 文件管理
- 文件上传/下载（支持断点续传）
- 文件复制/移动/重命名/删除
- 批量操作
- 回收站管理

### 3. 权限控制
- 角色管理（管理员/编辑者/查看者/仅评论者）
- 文件夹级权限
- 用户组管理
- 外部分享（密码/有效期/访问记录）

### 4. 版本管理
- 自动保存历史版本
- 版本对比
- 一键恢复

### 5. 协作功能
- 文件评论
- @成员提醒
- 在线预览（文档/表格/PPT/图片/PDF）

### 6. 搜索功能
- 多条件组合搜索
- 关键词模糊搜索
- 结果相关性排序

### 7. 管理后台
- 用户管理
- 权限配置
- 存储监控
- 日志查看与导出
- 系统配置

## 安全特性

- HTTPS加密传输
- **默认明文存储**（可选SM4/AES-256/外部SDK加密）
- 支持外部加密SDK扩展
- 操作日志审计（90天保留）
- 防暴力破解（登录限流）
- 文件访问权限控制
- 禁止下载权限（仅在线查看）

### 加密配置

系统**默认不加密**，直接明文存储文件。如需加密，可配置以下加密模式：

1. **明文存储（默认）**
   ```env
   ENCRYPTION_MODE=none
   # 或留空
   ```

2. **SM4国密算法加密**
   ```env
   ENCRYPTION_MODE=sm4
   ENCRYPTION_KEY=your-32-character-hex-key
   ```

3. **AES-256加密（兼容旧版本）**
   ```env
   ENCRYPTION_MODE=aes256
   ENCRYPTION_KEY=your-32-character-key
   ```

4. **外部SDK加密（扩展支持）**
   ```env
   ENCRYPTION_MODE=external
   EXTERNAL_SDK_PATH=/path/to/your-sdk.js
   EXTERNAL_SDK_CONFIG={"key":"your-key","algorithm":"your-algorithm"}
   ```

外部SDK接口示例请参考：`server/utils/external-encryption-sdk-example.js`

## 性能指标

- 支持30+人同时在线
- 单文件夹1000+文件加载≤3秒
- 服务器内存占用≤2GB
- CPU占用≤30%

## 开发计划

- [x] 项目基础架构
- [x] 用户认证系统
- [x] 文件管理核心功能
- [x] 权限控制系统
- [ ] 版本管理
- [ ] 在线预览
- [ ] 桌面客户端（Electron）
- [ ] 移动端APP（React Native）
- [ ] 断点续传优化
- [ ] 性能优化

## 许可证

MIT License

## 技术支持

- **操作指南**：`docs/operation-guide.md` - 完整的系统操作指南
- **用户手册**：`docs/user-manual.md` - 用户操作手册
- **系统架构**：`docs/system-architecture.md` - 系统架构与模块说明
- **部署文档**：`docs/deployment.md` - 部署指南
- **快速开始**：`QUICKSTART.md` - 快速启动指南

