const crypto = require('crypto');

// 尝试加载sm-crypto，如果失败则使用备用方案
let sm4 = null;
try {
  sm4 = require('sm-crypto').sm4;
} catch (error) {
  console.warn('sm-crypto未安装，SM4加密功能将不可用。使用明文模式或安装: npm install sm-crypto');
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-16chars';
const ENCRYPTION_MODE = process.env.ENCRYPTION_MODE || 'none'; // none, sm4, aes256, external
const EXTERNAL_SDK_PATH = process.env.EXTERNAL_SDK_PATH || null;
const EXTERNAL_SDK_CONFIG = process.env.EXTERNAL_SDK_CONFIG ? JSON.parse(process.env.EXTERNAL_SDK_CONFIG) : null;

// 外部SDK模块（动态加载）
let externalSDK = null;

// 加载外部SDK
function loadExternalSDK() {
  if (externalSDK) {
    return externalSDK;
  }
  
  if (!EXTERNAL_SDK_PATH) {
    return null;
  }
  
  try {
    externalSDK = require(EXTERNAL_SDK_PATH);
    console.log('外部加密SDK加载成功:', EXTERNAL_SDK_PATH);
    return externalSDK;
  } catch (error) {
    console.error('加载外部加密SDK失败:', error);
    return null;
  }
}

// 确保SM4密钥长度为32个十六进制字符（16字节，128位）
function getSM4Key() {
  let key = ENCRYPTION_KEY;
  
  // 如果密钥长度不是32个十六进制字符，使用MD5哈希生成
  if (key.length !== 32) {
    key = crypto.createHash('md5').update(ENCRYPTION_KEY).digest('hex');
  }
  
  // 确保密钥是32个十六进制字符
  if (key.length > 32) {
    key = key.substring(0, 32);
  } else if (key.length < 32) {
    // 如果密钥太短，用0填充
    key = key.padEnd(32, '0');
  }
  
  return key;
}

// 确保AES-256密钥长度为32字节（兼容旧版本）
function getAES256Key() {
  if (ENCRYPTION_KEY.length === 32) {
    return Buffer.from(ENCRYPTION_KEY);
  }
  // 如果密钥长度不对，使用SHA-256哈希生成32字节密钥
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

// SM4加密（默认）
function encryptWithSM4(buffer) {
  if (!sm4) {
    throw new Error('SM4加密功能不可用，请安装sm-crypto包: npm install sm-crypto');
  }
  
  const key = getSM4Key();
  
  // 将Buffer转换为十六进制字符串
  const dataHex = buffer.toString('hex');
  
  // SM4 ECB模式加密（sm-crypto库需要十六进制字符串）
  const encryptedHex = sm4.encrypt(dataHex, key);
  
  // 将加密后的十六进制字符串转换回Buffer
  return Buffer.from(encryptedHex, 'hex');
}

// SM4解密
function decryptWithSM4(encryptedBuffer) {
  if (!sm4) {
    throw new Error('SM4解密功能不可用，请安装sm-crypto包: npm install sm-crypto');
  }
  
  const key = getSM4Key();
  
  // 将加密的Buffer转换为十六进制字符串
  const encryptedHex = encryptedBuffer.toString('hex');
  
  // SM4 ECB模式解密
  const decryptedHex = sm4.decrypt(encryptedHex, key);
  
  // 将解密后的十六进制字符串转换回Buffer
  return Buffer.from(decryptedHex, 'hex');
}

// AES-256加密（兼容旧版本）
function encryptWithAES256(buffer) {
  const key = getAES256Key();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(buffer),
    cipher.final()
  ]);
  
  // 返回 iv + 加密数据
  return Buffer.concat([iv, encrypted]);
}

// AES-256解密（兼容旧版本）
function decryptWithAES256(encryptedBuffer) {
  const key = getAES256Key();
  const iv = encryptedBuffer.slice(0, 16);
  const encrypted = encryptedBuffer.slice(16);
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);
}

// 外部SDK加密
async function encryptWithExternalSDK(buffer) {
  const sdk = loadExternalSDK();
  if (!sdk) {
    throw new Error('外部加密SDK未配置或加载失败');
  }
  
  // 检查SDK是否有encrypt方法
  if (typeof sdk.encrypt !== 'function') {
    throw new Error('外部SDK必须实现encrypt方法');
  }
  
  // 调用外部SDK加密
  // 支持同步和异步两种方式
  if (sdk.encrypt.constructor.name === 'AsyncFunction') {
    return await sdk.encrypt(buffer, EXTERNAL_SDK_CONFIG);
  } else {
    return sdk.encrypt(buffer, EXTERNAL_SDK_CONFIG);
  }
}

// 外部SDK解密
async function decryptWithExternalSDK(encryptedBuffer) {
  const sdk = loadExternalSDK();
  if (!sdk) {
    throw new Error('外部加密SDK未配置或加载失败');
  }
  
  // 检查SDK是否有decrypt方法
  if (typeof sdk.decrypt !== 'function') {
    throw new Error('外部SDK必须实现decrypt方法');
  }
  
  // 调用外部SDK解密
  // 支持同步和异步两种方式
  if (sdk.decrypt.constructor.name === 'AsyncFunction') {
    return await sdk.decrypt(encryptedBuffer, EXTERNAL_SDK_CONFIG);
  } else {
    return sdk.decrypt(encryptedBuffer, EXTERNAL_SDK_CONFIG);
  }
}

// 加密文件（统一接口）
function encryptFile(buffer) {
  try {
    const mode = ENCRYPTION_MODE.toLowerCase();
    
    // 明文模式：直接返回原Buffer，不加密
    if (mode === 'none' || mode === 'plain' || mode === '') {
      return buffer;
    }
    
    switch (mode) {
      case 'sm4':
        return encryptWithSM4(buffer);
      
      case 'aes256':
      case 'aes-256':
        return encryptWithAES256(buffer);
      
      case 'external':
        // 外部SDK可能是异步的，这里返回Promise
        return encryptWithExternalSDK(buffer);
      
      default:
        console.warn(`未知的加密模式: ${ENCRYPTION_MODE}，使用明文存储`);
        return buffer;
    }
  } catch (error) {
    console.error('加密失败:', error);
    throw error;
  }
}

// 解密文件（统一接口）
function decryptFile(encryptedBuffer) {
  try {
    const mode = ENCRYPTION_MODE.toLowerCase();
    
    // 明文模式：直接返回原Buffer，不解密
    if (mode === 'none' || mode === 'plain' || mode === '') {
      return encryptedBuffer;
    }
    
    switch (mode) {
      case 'sm4':
        return decryptWithSM4(encryptedBuffer);
      
      case 'aes256':
      case 'aes-256':
        return decryptWithAES256(encryptedBuffer);
      
      case 'external':
        // 外部SDK可能是异步的，这里返回Promise
        return decryptWithExternalSDK(encryptedBuffer);
      
      default:
        console.warn(`未知的加密模式: ${ENCRYPTION_MODE}，使用明文读取`);
        return encryptedBuffer;
    }
  } catch (error) {
    console.error('解密失败:', error);
    throw error;
  }
}

// 生成文件哈希（使用SM3，国密算法）
function generateHash(buffer) {
  // 如果支持SM3，优先使用SM3
  try {
    const sm3 = require('sm-crypto').sm3;
    return sm3(buffer.toString('hex'));
  } catch (error) {
    // 如果不支持SM3，回退到SHA-256
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}

// 生成随机Token
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

// 获取当前加密模式
function getEncryptionMode() {
  return ENCRYPTION_MODE.toLowerCase();
}

// 检查外部SDK是否可用
function isExternalSDKAvailable() {
  return loadExternalSDK() !== null;
}

module.exports = {
  encryptFile,
  decryptFile,
  generateHash,
  generateToken,
  getEncryptionMode,
  isExternalSDKAvailable,
  // 导出具体加密方法供高级使用
  encryptWithSM4,
  decryptWithSM4,
  encryptWithAES256,
  decryptWithAES256,
  encryptWithExternalSDK,
  decryptWithExternalSDK
};
