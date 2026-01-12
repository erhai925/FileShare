# 加密配置指南

## 概述

FileShare系统**默认不加密**，直接明文存储文件。如需加密，可配置多种加密模式，包括SM4国密算法、AES-256加密，以及通过外部SDK进行自定义加密。

## 加密模式

### 1. 明文存储（默认）

系统默认不进行文件加密，直接明文存储，适合内部信任环境。

**配置方式：**
```env
ENCRYPTION_MODE=none
# 或
ENCRYPTION_MODE=plain
# 或留空
```

**特点：**
- 无需配置密钥
- 性能最优
- 文件可直接访问
- 适合内部环境

**注意事项：**
- 明文存储不提供数据保护
- 建议在安全的内网环境使用
- 如需安全保护，请启用加密模式

### 2. SM4加密（推荐）

SM4是中国的国家密码标准，采用128位分组密码算法，密钥长度为128位（16字节）。

**配置方式：**
```env
ENCRYPTION_MODE=sm4
ENCRYPTION_KEY=your-32-character-hex-key
```

**特点：**
- 符合国密标准
- 性能优秀
- 安全性高
- 密钥长度：32个十六进制字符（16字节，128位）

**密钥生成建议：**
```bash
# 使用openssl生成32个十六进制字符的密钥
openssl rand -hex 16
```

### 3. AES-256加密（兼容模式）

AES-256是国际标准加密算法，兼容旧版本数据。

**配置方式：**
```env
ENCRYPTION_MODE=aes256
ENCRYPTION_KEY=your-32-character-key
```

**特点：**
- 国际标准算法
- 兼容旧版本数据
- 密钥长度：32字节（256位）

**密钥生成建议：**
```bash
# 使用openssl生成32字节随机密钥
openssl rand -hex 32
```

### 4. 外部SDK加密（扩展模式）

支持通过外部SDK实现自定义加密算法，适用于企业级加密需求。

**配置方式：**
```env
ENCRYPTION_MODE=external
EXTERNAL_SDK_PATH=/path/to/your-encryption-sdk.js
EXTERNAL_SDK_CONFIG={"key":"your-key","algorithm":"your-algorithm"}
```

**SDK接口要求：**

外部SDK必须实现以下接口：

```javascript
module.exports = {
  /**
   * 加密方法
   * @param {Buffer} buffer - 要加密的文件数据
   * @param {Object} config - 配置对象（从EXTERNAL_SDK_CONFIG解析）
   * @returns {Buffer|Promise<Buffer>} 加密后的数据
   */
  encrypt: function(buffer, config) {
    // 实现加密逻辑
    return encryptedBuffer;
  },

  /**
   * 解密方法
   * @param {Buffer} encryptedBuffer - 加密的文件数据
   * @param {Object} config - 配置对象
   * @returns {Buffer|Promise<Buffer>} 解密后的数据
   */
  decrypt: function(encryptedBuffer, config) {
    // 实现解密逻辑
    return decryptedBuffer;
  }
};
```

**SDK示例：**

参考文件：`server/utils/external-encryption-sdk-example.js`

**同步SDK示例：**
```javascript
const crypto = require('crypto');

module.exports = {
  encrypt: function(buffer, config) {
    const key = config.key || 'default-key';
    const algorithm = config.algorithm || 'aes-256-cbc';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return Buffer.concat([iv, encrypted]);
  },

  decrypt: function(encryptedBuffer, config) {
    const key = config.key || 'default-key';
    const algorithm = config.algorithm || 'aes-256-cbc';
    const iv = encryptedBuffer.slice(0, 16);
    const encrypted = encryptedBuffer.slice(16);
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key, 'hex'), iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
};
```

**异步SDK示例：**
```javascript
module.exports = {
  encrypt: async function(buffer, config) {
    return new Promise((resolve, reject) => {
      // 异步加密操作
      yourAsyncEncryptionSDK.encrypt(buffer, config, (err, encrypted) => {
        if (err) reject(err);
        else resolve(Buffer.from(encrypted));
      });
    });
  },

  decrypt: async function(encryptedBuffer, config) {
    return new Promise((resolve, reject) => {
      // 异步解密操作
      yourAsyncDecryptionSDK.decrypt(encryptedBuffer, config, (err, decrypted) => {
        if (err) reject(err);
        else resolve(Buffer.from(decrypted));
      });
    });
  }
};
```

## 配置步骤

### 1. 选择加密模式

根据您的需求选择合适的加密模式：
- **新部署**：推荐使用SM4（默认）
- **升级系统**：如果已有AES-256加密的数据，使用AES-256模式
- **企业定制**：使用外部SDK模式

### 2. 生成加密密钥

**SM4密钥（16字节）：**
```bash
openssl rand -hex 16
```

**AES-256密钥（32字节）：**
```bash
openssl rand -hex 32
```

### 3. 配置环境变量

编辑 `.env` 文件：

```env
# SM4加密配置（推荐）
ENCRYPTION_MODE=sm4
ENCRYPTION_KEY=your-generated-16-byte-key

# 或AES-256加密配置
# ENCRYPTION_MODE=aes256
# ENCRYPTION_KEY=your-generated-32-byte-key

# 或外部SDK配置
# ENCRYPTION_MODE=external
# EXTERNAL_SDK_PATH=/path/to/your-sdk.js
# EXTERNAL_SDK_CONFIG={"key":"your-key","algorithm":"your-algorithm"}
```

### 4. 重启服务

```bash
pm2 restart fileshare
# 或
npm run server:start
```

## 加密模式切换

### 从AES-256切换到SM4

1. **备份数据**
   ```bash
   npm run backup
   ```

2. **迁移加密数据**
   - 使用AES-256模式解密所有文件
   - 使用SM4模式重新加密
   - 更新数据库记录

3. **更新配置**
   ```env
   ENCRYPTION_MODE=sm4
   ENCRYPTION_KEY=new-sm4-key
   ```

4. **重启服务**

### 切换到外部SDK

1. **开发SDK**
   - 参考示例文件实现encrypt和decrypt方法
   - 测试SDK功能

2. **配置环境变量**
   ```env
   ENCRYPTION_MODE=external
   EXTERNAL_SDK_PATH=/path/to/your-sdk.js
   EXTERNAL_SDK_CONFIG={"key":"your-key"}
   ```

3. **验证SDK加载**
   - 查看启动日志，确认SDK加载成功
   - 测试文件上传下载功能

## 安全建议

1. **密钥管理**
   - 使用强随机密钥
   - 定期更换密钥
   - 密钥不要提交到代码仓库
   - 使用密钥管理服务（如HashiCorp Vault）

2. **密钥长度**
   - SM4：16字节（128位）
   - AES-256：32字节（256位）
   - 外部SDK：根据算法要求

3. **密钥存储**
   - 存储在环境变量中
   - 使用配置文件（.env），并加入.gitignore
   - 生产环境使用密钥管理服务

4. **加密性能**
   - SM4性能优秀，适合大文件加密
   - 外部SDK应优化性能，避免阻塞
   - 考虑使用异步加密提升并发能力

## 故障排查

### SDK加载失败

**问题：** 外部SDK无法加载

**解决方案：**
1. 检查SDK文件路径是否正确
2. 检查SDK文件权限
3. 检查SDK是否导出encrypt和decrypt方法
4. 查看服务器日志获取详细错误信息

### 加密/解密失败

**问题：** 文件加密或解密失败

**解决方案：**
1. 检查加密密钥是否正确
2. 检查加密模式是否匹配
3. 检查文件是否损坏
4. 查看错误日志

### 性能问题

**问题：** 加密/解密速度慢

**解决方案：**
1. 使用异步SDK提升并发
2. 优化SDK实现
3. 考虑使用硬件加速
4. 检查服务器资源使用情况

## 技术支持

如有问题，请查看：
- SDK示例：`server/utils/external-encryption-sdk-example.js`
- 加密工具源码：`server/utils/encryption.js`
- 系统日志：管理后台 > 操作日志

