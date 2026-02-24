/**
 * PM2 启动配置文件
 * 前后端均由 PM2 启动，支持版本信息、分离日志、日志过期自动删除
 *
 * 部署步骤：
 *   1. npm install && cd client && npm install && cd ..
 *   2. pm2 start ecosystem.config.js
 *
 * 生产环境（仅后端托管静态文件）：
 *   1. npm run client:build   # 构建前端
 *   2. pm2 start ecosystem.config.js --only fileshare
 *
 * 日志轮转（自动删除过期日志）：
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 10M
 *   pm2 set pm2-logrotate:retain 30
 *   pm2 set pm2-logrotate:compress true
 *
 * 使用方法：
 *   pm2 start ecosystem.config.js   # 同时启动前后端
 *   pm2 stop all
 *   pm2 logs fileshare
 *   pm2 logs fileshare-client
 */

const path = require('path');
const fs = require('fs');
const version = require('./upgrades/version.json').currentVersion || '1.0.0';

// 前后端日志输出目录：项目根目录下的 logs/
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const clientDir = path.join(__dirname, 'client');

module.exports = {
  apps: [
    {
      name: 'fileshare',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: path.join(logsDir, 'server-error.log'),
      out_file: path.join(logsDir, 'server-out.log'),
      log_file: path.join(logsDir, 'server-combined.log'),
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      version
    },
    {
      name: 'fileshare-client',
      script: 'npx',
      args: ['vite', '--host'],
      cwd: clientDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development'
      },
      error_file: path.join(logsDir, 'client-error.log'),
      out_file: path.join(logsDir, 'client-out.log'),
      log_file: path.join(logsDir, 'client-combined.log'),
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      version
    }
  ]
};
