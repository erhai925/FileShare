#!/usr/bin/env node

/**
 * 确保 operation_logs 表存在
 * 用于修复登录次数统计功能（依赖 operation_logs 表）
 *
 * 使用场景：升级后登录次数显示异常，可单独运行此脚本修复
 * 用法：DB_PATH=./data/fileshare.db node server/scripts/ensure-operation-logs.js
 */

require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/fileshare.db');

async function main() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('无法连接数据库:', err.message);
        process.exit(1);
      }
    });

    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id INTEGER,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`, (err) => {
        if (err) {
          console.error('创建 operation_logs 表失败:', err.message);
          db.close();
          process.exit(1);
        }
        console.log('✓ operation_logs 表已就绪');
      });

      db.run(`CREATE INDEX IF NOT EXISTS idx_logs_user ON operation_logs(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_logs_created ON operation_logs(created_at)`);

      db.close((err) => {
        if (err) {
          console.error('关闭数据库失败:', err.message);
          process.exit(1);
        }
        console.log('数据库迁移完成，请重启服务后查看登录次数统计');
        resolve();
      });
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
