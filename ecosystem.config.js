/**
 * PM2 启动配置文件
 * 生产环境：单进程启动服务端（同时托管前端静态文件），支持版本信息、分离日志、日志过期自动删除
 *
 * 部署步骤：
 *   1. npm run build   # 构建前端
 *   2. pm2 start ecosystem.config.js
 *
 * 日志轮转（自动删除过期日志）：
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 10M
 *   pm2 set pm2-logrotate:retain 30
 *   pm2 set pm2-logrotate:compress true
 *
 * 使用方法：
 *   pm2 start ecosystem.config.js
 *   pm2 stop fileshare
 *   pm2 logs fileshare
 */

const path = require('path');
const fs = require('fs');
const version = require('./upgrades/version.json').currentVersion || '1.0.0';

// 前后端日志输出目录：项目根目录下的 logs/
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

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
    }
  ]
};
