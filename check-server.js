#!/usr/bin/env node

/**
 * 服务器连接检查脚本
 * 用于诊断后端服务器是否正常运行
 */

const http = require('http');

const PORT = process.env.PORT || 3000;
const HOST = 'localhost';

console.log(`正在检查服务器 http://${HOST}:${PORT}...`);

const options = {
  hostname: HOST,
  port: PORT,
  path: '/api/health',
  method: 'GET',
  timeout: 3000
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ 服务器运行正常！');
      console.log('响应:', data);
      process.exit(0);
    } else {
      console.log(`❌ 服务器响应异常，状态码: ${res.statusCode}`);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.log('❌ 无法连接到服务器');
  console.log('错误:', error.message);
  console.log('\n可能的原因:');
  console.log('1. 后端服务器未启动');
  console.log('2. 服务器运行在不同的端口');
  console.log('3. 服务器已崩溃');
  console.log('\n解决方案:');
  console.log('1. 检查后端服务器是否正在运行');
  console.log('2. 运行: npm run server:dev');
  console.log('3. 或运行: npm run dev (同时启动前后端)');
  process.exit(1);
});

req.on('timeout', () => {
  console.log('❌ 连接超时');
  req.destroy();
  process.exit(1);
});

req.end();





