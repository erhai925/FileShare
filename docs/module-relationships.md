# FileShare 系统模块关系说明

## 一、模块概览

FileShare 系统采用模块化设计，共包含 **11个核心模块**，各模块职责明确，通过标准接口协作。

## 二、模块依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端层 (Client)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 登录页面  │  │ 文件管理  │  │ 空间管理  │  │ 管理后台  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
└───────┼──────────────┼──────────────┼─────────────┼────────┘
        │              │              │             │
        └──────────────┴──────────────┴─────────────┘
                           │
                    HTTP/HTTPS API
                           │
┌─────────────────────────────────────────────────────────────┐
│                   后端服务层 (Server)                         │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           认证中间件 (authenticate)                   │   │
│  │  所有请求必须先通过认证，获取用户信息                  │   │
│  └────────────────────┬────────────────────────────────┘   │
│                       │                                      │
│        ┌──────────────┼──────────────┐                      │
│        │              │              │                       │
│  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐              │
│  │ 文件管理   │  │ 空间管理   │  │ 用户管理   │              │
│  │ (files)    │  │ (spaces)   │  │ (users)    │              │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘              │
│        │              │              │                       │
│        └──────────────┼──────────────┘                       │
│                       │                                      │
│              ┌────────▼────────┐                            │
│              │  权限控制模块    │                            │
│              │ (permissions)   │                            │
│              └────────┬────────┘                            │
│                       │                                      │
│        ┌───────────────┼───────────────┐                     │
│        │               │               │                     │
│  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐             │
│  │ 文件分享   │  │ 评论模块   │  │ 搜索模块   │             │
│  │ (shares)   │  │ (comments) │  │ (search)   │             │
│  └────────────┘  └────────────┘  └────────────┘             │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  工具模块层                                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │ 加密模块  │  │ 日志模块  │  │ 管理后台  │         │   │
│  │  │(encrypt) │  │ (logger)  │  │ (admin)  │         │   │
│  │  └──────────┘  └──────────┘  └──────────┘         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│  SQLite 数据库 │  │  文件存储系统  │  │  日志文件     │
│  (data/)      │  │  (storage/)   │  │  (logs/)     │
└───────────────┘  └───────────────┘  └───────────────┘
```

## 三、模块详细说明

### 1. 认证模块 (auth) - 核心基础模块

**文件位置**：
- `server/routes/auth.js` - 认证路由
- `server/middleware/auth.js` - 认证中间件

**核心功能**：
- 用户登录/注册
- JWT Token 生成和验证
- 用户身份验证

**依赖关系**：
- ✅ **无依赖**（基础模块）
- ✅ **被所有模块依赖**（所有业务操作都需要认证）

**数据表**：
- `users` - 用户信息

**调用示例**：
```javascript
// 所有路由都需要使用 authenticate 中间件
router.get('/files', authenticate, async (req, res) => {
  // req.user 包含当前用户信息
  const userId = req.user.id;
});
```

---

### 2. 文件管理模块 (files) - 核心业务模块

**文件位置**：
- `server/routes/files.js` - 文件路由
- `client/src/pages/Files.tsx` - 文件管理页面

**核心功能**：
- 文件上传/下载
- 文件列表查询
- 文件重命名/删除
- 文件版本管理

**依赖关系**：
- ✅ **依赖认证模块** - 需要用户登录
- ✅ **依赖权限模块** - 检查文件访问权限
- ✅ **依赖加密模块** - 文件加密/解密
- ✅ **依赖日志模块** - 记录操作日志
- ✅ **依赖空间模块** - 文件可以关联到空间

**数据表**：
- `files` - 文件信息
- `file_versions` - 文件版本

**数据流**：
```
上传: 文件 → 权限检查 → 加密 → 存储 → 数据库记录 → 日志
下载: 请求 → 权限检查 → 读取 → 解密 → 返回文件 → 日志
```

---

### 3. 空间管理模块 (spaces) - 组织架构模块

**文件位置**：
- `server/routes/spaces.js` - 空间路由
- `client/src/pages/Spaces.tsx` - 空间管理页面

**核心功能**：
- 创建空间（团队/部门/个人/项目）
- 空间列表查询
- 创建文件夹

**依赖关系**：
- ✅ **依赖认证模块** - 需要用户登录
- ✅ **依赖权限模块** - 检查空间访问权限
- ✅ **被文件模块依赖** - 文件可以关联到空间

**数据表**：
- `spaces` - 空间信息
- `folders` - 文件夹信息
- `permissions` - 空间权限（空间成员关联）

**空间类型**：
- `team` - 团队空间（管理员创建）
- `department` - 部门空间（管理员创建）
- `personal` - 个人空间（所有用户）
- `project` - 项目空间（所有用户）

**空间成员关联机制**：

空间与成员的关联通过以下三种方式实现：

1. **直接关联（空间所有者）**
   ```
   spaces.owner_id → users.id
   ```
   - 创建空间时自动设置
   - 所有者自动拥有所有权限
   - 无法被移除

2. **权限表关联（普通成员）**
   ```
   permissions 表：
   - resource_type = 'space'
   - resource_id = 空间ID
   - user_id = 用户ID
   - permission_type = 权限类型（read/write/delete/comment/download）
   ```
   - 通过权限表建立空间与用户的关联
   - 支持为不同用户设置不同权限
   - 支持多权限类型组合

3. **用户组关联（批量授权）**
   ```
   permissions 表：
   - resource_type = 'space'
   - resource_id = 空间ID
   - group_id = 用户组ID
   
   user_group_members 表：
   - group_id = 用户组ID
   - user_id = 用户ID
   ```
   - 通过用户组批量授权
   - 用户组成员自动继承组权限
   - 便于批量管理

**成员管理API**：
- `POST /api/spaces/:spaceId/members` - 添加空间成员
- `GET /api/spaces/:spaceId/members` - 获取空间成员列表
- `DELETE /api/spaces/:spaceId/members/:userId` - 移除空间成员

---

### 4. 权限控制模块 (permissions) - 安全核心模块

**文件位置**：
- `server/routes/permissions.js` - 权限路由
- `server/middleware/auth.js` - 权限检查函数

**核心功能**：
- 设置文件/文件夹/空间权限
- 权限检查（read/write/delete/comment/download）
- 用户组权限管理

**依赖关系**：
- ✅ **依赖认证模块** - 需要用户信息
- ✅ **被所有资源模块依赖** - 文件、空间、分享、评论都需要权限检查

**数据表**：
- `permissions` - 权限记录
- `user_groups` - 用户组
- `user_group_members` - 用户组成员

**权限检查逻辑**：
```
1. 管理员 → 返回 true（拥有所有权限）
2. 资源所有者 → 返回 true（创建者自动拥有权限）
3. 直接权限 → 查询 permissions 表
4. 用户组权限 → 查询用户组关联的权限
5. 默认 → 返回 false（无权限）
```

**调用示例**：
```javascript
// 检查文件读取权限
const hasPermission = await checkPermission(userId, 'file', fileId, 'read');
if (!hasPermission) {
  return res.status(403).json({ message: '无访问权限' });
}
```

---

### 5. 加密模块 (encryption) - 安全工具模块

**文件位置**：
- `server/utils/encryption.js` - 加密工具

**核心功能**：
- 文件加密/解密
- 文件哈希生成
- Token 生成

**依赖关系**：
- ✅ **无依赖**（工具模块）
- ✅ **被文件管理模块依赖** - 文件上传时加密，下载时解密

**加密模式**：
- `none/plain` - 明文存储（默认）
- `sm4` - SM4 国密算法
- `aes256` - AES-256 加密
- `external` - 外部 SDK 加密

**调用示例**：
```javascript
// 加密文件
const encrypted = encryptFile(fileBuffer);

// 解密文件
const decrypted = decryptFile(encryptedBuffer);
```

---

### 6. 日志模块 (logger) - 审计模块

**文件位置**：
- `server/utils/logger.js` - 日志工具
- `server/routes/logs.js` - 日志查询路由

**核心功能**：
- 记录所有用户操作
- 日志查询和导出
- 自动清理过期日志

**依赖关系**：
- ✅ **依赖认证模块** - 需要用户信息
- ✅ **被所有业务模块调用** - 记录操作日志

**数据表**：
- `operation_logs` - 操作日志

**记录内容**：
- 操作人（user_id）
- 操作类型（action）
- 资源类型和ID（resource_type, resource_id）
- 操作详情（details - JSON）
- IP地址和User-Agent
- 操作时间

**调用示例**：
```javascript
await logOperation(userId, 'upload_file', 'file', fileId, {
  fileName: 'example.pdf',
  fileSize: 1024
}, req);
```

---

### 7. 用户管理模块 (users) - 管理模块

**文件位置**：
- `server/routes/users.js` - 用户路由
- `client/src/pages/Admin.tsx` - 用户管理页面

**核心功能**：
- 用户列表查询
- 创建新用户
- 修改用户信息
- 启用/禁用用户
- 撤销用户权限

**依赖关系**：
- ✅ **依赖认证模块** - 需要管理员权限
- ✅ **依赖日志模块** - 记录操作日志
- ✅ **影响权限模块** - 用户信息影响权限判断

**数据表**：
- `users` - 用户信息

**权限要求**：
- 只有管理员可以访问用户管理功能
- 使用 `requireAdmin` 中间件保护

---

### 8. 文件分享模块 (shares) - 协作模块

**文件位置**：
- `server/routes/shares.js` - 分享路由

**核心功能**：
- 创建外部分享链接
- 分享链接访问验证
- 分享访问记录
- 撤销分享

**依赖关系**：
- ✅ **依赖认证模块** - 创建分享需要登录
- ✅ **依赖权限模块** - 检查分享权限
- ✅ **依赖文件模块** - 分享文件资源

**数据表**：
- `external_shares` - 外部分享
- `share_access_logs` - 分享访问记录

**分享流程**：
```
创建分享 → 生成Token → 设置密码/邮箱/有效期 → 保存到数据库
访问分享 → 验证Token → 验证密码/邮箱 → 检查有效期 → 记录访问 → 返回资源
```

---

### 9. 评论模块 (comments) - 协作模块

**文件位置**：
- `server/routes/comments.js` - 评论路由

**核心功能**：
- 添加文件评论
- @成员提醒
- 查看评论列表
- 删除评论

**依赖关系**：
- ✅ **依赖认证模块** - 需要用户登录
- ✅ **依赖权限模块** - 需要 comment 权限
- ✅ **依赖文件模块** - 评论关联到文件

**数据表**：
- `comments` - 评论信息

**功能特点**：
- 支持回复评论（parent_id）
- 支持@成员提醒（mentioned_users）
- 评论者可以删除自己的评论
- 管理员可以删除所有评论

---

### 10. 搜索模块 (search) - 查询模块

**文件位置**：
- `server/routes/search.js` - 搜索路由

**核心功能**：
- 多条件组合搜索
- 关键词模糊搜索
- 结果按相关性排序

**依赖关系**：
- ✅ **依赖认证模块** - 需要用户登录
- ✅ **依赖权限模块** - 只返回有权限的文件
- ✅ **依赖文件模块** - 搜索文件资源

**搜索条件**：
- 文件名/关键词（模糊匹配）
- 文件类型（精确匹配）
- 上传时间范围
- 上传人
- 所属空间

**权限过滤**：
- 自动过滤无权限的文件
- 只返回用户有 read 权限的文件

---

### 11. 管理后台模块 (admin) - 系统管理模块

**文件位置**：
- `server/routes/admin.js` - 管理路由
- `client/src/pages/Admin.tsx` - 管理后台页面

**核心功能**：
- 系统统计信息
- 系统配置管理
- 清理回收站
- 清理过期版本

**依赖关系**：
- ✅ **依赖认证模块** - 需要管理员权限
- ✅ **查询多个模块** - 统计各模块数据
- ✅ **依赖日志模块** - 记录管理操作

**数据表**：
- `system_config` - 系统配置

**管理功能**：
- 用户统计（总数/活跃/管理员数）
- 文件统计（总数/大小/已删除）
- 空间统计
- 存储使用情况
- 系统配置（版本保留/回收站保留/日志保留天数）

## 四、模块间数据流

### 1. 文件上传数据流

```
前端选择文件
    ↓
POST /api/files/upload
    ↓
authenticate 中间件 → 验证Token → 获取用户信息
    ↓
权限检查 (checkPermission) → 检查空间write权限
    ↓
Multer 接收文件 → 保存到临时目录
    ↓
读取文件 → 生成哈希
    ↓
加密处理 (encryptFile) → 根据模式加密/明文
    ↓
保存到存储目录 (storage/files 或 storage/encrypted)
    ↓
数据库记录 (INSERT INTO files)
    ↓
版本记录 (INSERT INTO file_versions)
    ↓
日志记录 (logOperation)
    ↓
返回成功响应
```

### 2. 文件下载数据流

```
前端点击下载
    ↓
GET /api/files/download/:fileId
    ↓
authenticate 中间件 → 验证Token
    ↓
权限检查 (checkPermission) → 检查文件read权限
    ↓
查询文件信息 (SELECT FROM files)
    ↓
检查文件是否存在 (fs.access)
    ↓
读取文件 (fs.readFile)
    ↓
解密处理 (decryptFile) → 根据模式解密/直接返回
    ↓
设置响应头 (Content-Type, Content-Disposition)
    ↓
日志记录 (logOperation)
    ↓
返回文件流
```

### 3. 权限检查数据流

```
权限检查请求
    ↓
检查用户角色 → 管理员？ → 是 → 返回 true
    ↓ 否
检查资源所有者
    ├── 文件？ → 检查 files.created_by
    ├── 空间？ → 检查 spaces.owner_id
    └── 其他？ → 检查对应表的owner_id
    ↓
检查直接权限 (SELECT FROM permissions WHERE user_id=?)
    ↓ 有权限？
检查用户组权限 (SELECT FROM permissions + user_group_members)
    ↓ 有权限？
返回 false（无权限）
```

### 4. 空间创建数据流

```
前端填写表单
    ↓
POST /api/spaces
    ↓
authenticate 中间件 → 验证Token
    ↓
验证角色权限 → 团队/部门空间需要管理员
    ↓
验证输入数据（名称、类型）
    ↓
数据库记录 (INSERT INTO spaces)
    ↓
日志记录 (logOperation)
    ↓
返回成功响应
```

## 五、模块通信接口

### 1. 认证接口

**中间件**: `authenticate`
```javascript
// 使用方式
router.get('/api/files', authenticate, handler);

// 效果
// - 验证JWT Token
// - 将用户信息附加到 req.user
// - 如果未认证，返回401错误
```

### 2. 权限检查接口

**函数**: `checkPermission(userId, resourceType, resourceId, permissionType)`
```javascript
// 使用方式
const hasPermission = await checkPermission(
  req.user.id,    // 用户ID
  'file',         // 资源类型
  fileId,         // 资源ID
  'read'          // 权限类型
);

// 返回: true/false
```

### 3. 日志记录接口

**函数**: `logOperation(userId, action, resourceType, resourceId, details, req)`
```javascript
// 使用方式
await logOperation(
  req.user.id,           // 用户ID
  'upload_file',         // 操作类型
  'file',                // 资源类型
  fileId,                // 资源ID
  { fileName: 'xxx' },   // 操作详情
  req                    // 请求对象（获取IP等信息）
);
```

### 4. 加密接口

**函数**: `encryptFile(buffer)`, `decryptFile(encryptedBuffer)`
```javascript
// 使用方式
const encrypted = encryptFile(fileBuffer);
const decrypted = decryptFile(encryptedBuffer);

// 支持异步（外部SDK）
if (encrypted instanceof Promise) {
  encrypted = await encrypted;
}
```

## 六、数据库关联关系

### 核心关联

```
users (用户)
  │
  ├─→ files.created_by (创建的文件)
  ├─→ files.updated_by (更新的文件)
  ├─→ spaces.owner_id (拥有的空间)
  ├─→ folders.created_by (创建的文件夹)
  ├─→ permissions.user_id (拥有的权限)
  └─→ permissions.granted_by (授予的权限)

spaces (空间)
  │
  ├─→ files.space_id (空间中的文件)
  ├─→ folders.space_id (空间中的文件夹)
  └─→ permissions.resource_id (空间的权限)

files (文件)
  │
  ├─→ file_versions.file_id (文件版本)
  ├─→ comments.file_id (文件评论)
  └─→ permissions.resource_id (文件权限)

folders (文件夹)
  │
  ├─→ files.folder_id (文件夹中的文件)
  └─→ folders.parent_id (父文件夹)

permissions (权限)
  │
  ├─→ user_id (用户权限)
  └─→ group_id (用户组权限)
```

## 七、扩展点说明

### 1. 新增业务模块

**步骤**：
1. 创建路由文件：`server/routes/new-module.js`
2. 实现业务逻辑
3. 添加认证：使用 `authenticate` 中间件
4. 添加权限：使用 `checkPermission` 函数
5. 记录日志：使用 `logOperation` 函数
6. 创建前端页面：`client/src/pages/NewModule.tsx`
7. 注册路由：在 `client/src/App.tsx` 中添加

### 2. 新增加密方式

**步骤**：
1. 在 `server/utils/encryption.js` 中添加新的加密函数
2. 在 `encryptFile` 和 `decryptFile` 中添加新的 case
3. 更新环境变量配置说明

### 3. 新增权限类型

**步骤**：
1. 修改数据库表结构（permissions.permission_type）
2. 更新权限检查逻辑
3. 更新前端权限设置界面

## 八、最佳实践

### 1. 模块设计原则

- **单一职责**：每个模块只负责一个功能领域
- **低耦合**：模块间通过标准接口通信
- **高内聚**：模块内部功能紧密相关
- **可扩展**：预留扩展接口

### 2. 错误处理

- 统一的错误响应格式
- 详细的错误日志记录
- 用户友好的错误提示

### 3. 性能优化

- 数据库查询优化（索引、分页）
- 文件处理优化（流式处理）
- 前端缓存（React Query）

---

**文档版本**：v1.0  
**最后更新**：2024年

