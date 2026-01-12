# 加密模块更新日志

## 更新内容

### 1. 默认加密算法改为SM4

- **变更前**：默认使用AES-256加密
- **变更后**：默认使用SM4国密算法加密
- **影响**：新部署的系统默认使用SM4，已有AES-256加密的数据可通过配置兼容

### 2. 支持外部SDK加密

- **新增功能**：支持通过外部SDK实现自定义加密算法
- **配置方式**：通过环境变量 `ENCRYPTION_MODE=external` 启用
- **接口规范**：外部SDK需实现 `encrypt` 和 `decrypt` 方法
- **支持同步/异步**：外部SDK可以是同步或异步实现

### 3. 加密模式配置

系统现在支持三种加密模式：

1. **SM4（默认）**
   ```env
   ENCRYPTION_MODE=sm4
   ENCRYPTION_KEY=your-32-character-hex-key
   ```

2. **AES-256（兼容模式）**
   ```env
   ENCRYPTION_MODE=aes256
   ENCRYPTION_KEY=your-32-character-key
   ```

3. **外部SDK（扩展模式）**
   ```env
   ENCRYPTION_MODE=external
   EXTERNAL_SDK_PATH=/path/to/your-sdk.js
   EXTERNAL_SDK_CONFIG={"key":"your-key"}
   ```

## 文件变更

### 修改的文件

1. **server/utils/encryption.js**
   - 实现SM4加密/解密
   - 保留AES-256兼容支持
   - 新增外部SDK接口
   - 支持异步外部SDK

2. **server/routes/files.js**
   - 更新文件上传逻辑，支持异步加密
   - 更新文件下载逻辑，支持异步解密

3. **package.json**
   - 新增依赖：`sm-crypto`（SM4加密库）
   - 新增依赖：`gm-crypt`（国密算法库）

### 新增的文件

1. **server/utils/external-encryption-sdk-example.js**
   - 外部SDK接口示例
   - 同步和异步实现示例

2. **docs/encryption-config.md**
   - 加密配置详细文档
   - SDK开发指南
   - 故障排查指南

## 升级指南

### 从AES-256升级到SM4

1. **备份数据**
   ```bash
   npm run backup
   ```

2. **更新配置**
   ```env
   ENCRYPTION_MODE=sm4
   ENCRYPTION_KEY=your-new-sm4-key
   ```
   
   生成SM4密钥：
   ```bash
   openssl rand -hex 16
   ```

3. **重启服务**
   ```bash
   pm2 restart fileshare
   ```

**注意**：升级后，旧文件仍使用AES-256加密，新文件使用SM4加密。如需统一加密方式，需要迁移数据。

### 使用外部SDK

1. **开发SDK**
   - 参考 `server/utils/external-encryption-sdk-example.js`
   - 实现 `encrypt` 和 `decrypt` 方法

2. **配置环境变量**
   ```env
   ENCRYPTION_MODE=external
   EXTERNAL_SDK_PATH=/path/to/your-sdk.js
   EXTERNAL_SDK_CONFIG={"key":"your-key"}
   ```

3. **验证**
   - 查看启动日志，确认SDK加载成功
   - 测试文件上传下载功能

## 兼容性说明

- **向后兼容**：保留AES-256加密支持，旧数据可正常访问
- **接口兼容**：`encryptFile` 和 `decryptFile` 接口保持不变
- **配置兼容**：未配置 `ENCRYPTION_MODE` 时默认使用SM4

## 安全建议

1. **密钥管理**
   - 使用强随机密钥
   - 定期更换密钥
   - 密钥不要提交到代码仓库

2. **密钥长度**
   - SM4：32个十六进制字符（16字节）
   - AES-256：32字节
   - 外部SDK：根据算法要求

3. **生产环境**
   - 使用密钥管理服务
   - 启用HTTPS传输
   - 定期审计加密配置

## 技术支持

- 加密配置文档：`docs/encryption-config.md`
- SDK示例：`server/utils/external-encryption-sdk-example.js`
- 加密工具源码：`server/utils/encryption.js`





