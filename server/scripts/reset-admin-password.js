/**
 * 重置 admin 账户的登录密码为 admin123
 * 使用方式：在项目根目录执行 node server/scripts/reset-admin-password.js
 */
require('dotenv').config();
const db = require('../config/database');
const bcrypt = require('bcryptjs');

async function reset() {
  try {
    await db.init();
    const admin = await db.get("SELECT id, username FROM users WHERE username = ?", ['admin']);
    if (!admin) {
      console.error('未找到 admin 用户');
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash('admin123', 10);
    await db.run(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, admin.id]
    );
    console.log('admin 密码已重置为: admin123');
    process.exit(0);
  } catch (err) {
    console.error('重置失败:', err);
    process.exit(1);
  }
}

reset();
