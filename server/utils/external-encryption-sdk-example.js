/**
 * 外部加密SDK示例
 * 
 * 此文件展示了如何实现外部加密SDK接口
 * 将您的SDK文件放在指定路径，并在.env中配置EXTERNAL_SDK_PATH
 * 
 * 外部SDK必须实现以下接口：
 * - encrypt(buffer, config): 加密方法，返回Buffer或Promise<Buffer>
 * - decrypt(encryptedBuffer, config): 解密方法，返回Buffer或Promise<Buffer>
 */

/**
 * 示例1: 同步加密SDK
 */
module.exports = {
  /**
   * 加密文件
   * @param {Buffer} buffer - 要加密的文件数据
   * @param {Object} config - 配置对象（从EXTERNAL_SDK_CONFIG环境变量解析）
   * @returns {Buffer} 加密后的数据
   */
  encrypt: function(buffer, config) {
    // 这里调用您的加密SDK
    // 示例：使用配置中的密钥进行加密
    const crypto = require('crypto');
    const key = config?.key || 'default-key';
    const algorithm = config?.algorithm || 'aes-256-cbc';
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'hex'), iv);
    
    const encrypted = Buffer.concat([
      cipher.update(buffer),
      cipher.final()
    ]);
    
    // 返回 iv + 加密数据
    return Buffer.concat([iv, encrypted]);
  },

  /**
   * 解密文件
   * @param {Buffer} encryptedBuffer - 加密的文件数据
   * @param {Object} config - 配置对象
   * @returns {Buffer} 解密后的数据
   */
  decrypt: function(encryptedBuffer, config) {
    // 这里调用您的解密SDK
    const crypto = require('crypto');
    const key = config?.key || 'default-key';
    const algorithm = config?.algorithm || 'aes-256-cbc';
    
    const iv = encryptedBuffer.slice(0, 16);
    const encrypted = encryptedBuffer.slice(16);
    
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key, 'hex'), iv);
    
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
  }
};

/**
 * 示例2: 异步加密SDK（使用Promise）
 */
/*
module.exports = {
  encrypt: async function(buffer, config) {
    // 异步加密操作
    return new Promise((resolve, reject) => {
      // 调用您的异步加密SDK
      setTimeout(() => {
        try {
          // 执行加密
          const encrypted = yourEncryptionSDK.encrypt(buffer, config);
          resolve(Buffer.from(encrypted));
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  },

  decrypt: async function(encryptedBuffer, config) {
    // 异步解密操作
    return new Promise((resolve, reject) => {
      // 调用您的异步解密SDK
      setTimeout(() => {
        try {
          // 执行解密
          const decrypted = yourDecryptionSDK.decrypt(encryptedBuffer, config);
          resolve(Buffer.from(decrypted));
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  }
};
*/

/**
 * 使用说明：
 * 
 * 1. 将您的SDK实现保存为文件，例如：/path/to/your-sdk.js
 * 
 * 2. 在.env文件中配置：
 *    ENCRYPTION_MODE=external
 *    EXTERNAL_SDK_PATH=/path/to/your-sdk.js
 *    EXTERNAL_SDK_CONFIG={"key":"your-encryption-key","algorithm":"aes-256-cbc"}
 * 
 * 3. 重启服务，系统将自动加载外部SDK
 * 
 * 注意事项：
 * - SDK必须导出encrypt和decrypt方法
 * - 方法可以是同步或异步的（返回Promise）
 * - 输入和输出都应该是Buffer类型
 * - 如果SDK加载失败，系统会回退到默认的SM4加密
 */





