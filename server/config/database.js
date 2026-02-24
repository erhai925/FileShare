const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

const DB_PATH = process.env.DB_PATH || './data/fileshare.db';

let db = null;

// 初始化数据库
async function init() {
  return new Promise((resolve, reject) => {
    // 确保数据目录存在
    const dbDir = path.dirname(DB_PATH);
    fs.mkdir(dbDir, { recursive: true }).then(() => {
      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('数据库连接成功');
          createTables().then(resolve).catch(reject);
        }
      });
    }).catch(reject);
  });
}

// 创建数据表
async function createTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 用户表
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        real_name TEXT,
        role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'editor', 'viewer', 'commenter')),
        avatar TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // 空间表（团队空间、部门空间、个人空间、项目空间）
      db.run(`CREATE TABLE IF NOT EXISTS spaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('team', 'department', 'personal', 'project')),
        description TEXT,
        owner_id INTEGER,
        parent_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id),
        FOREIGN KEY (parent_id) REFERENCES spaces(id)
      )`);

      // 文件夹表
      db.run(`CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        space_id INTEGER NOT NULL,
        parent_id INTEGER,
        path TEXT NOT NULL,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (space_id) REFERENCES spaces(id),
        FOREIGN KEY (parent_id) REFERENCES folders(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      // 文件表
      db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        folder_id INTEGER,
        space_id INTEGER,
        file_path TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        mime_type TEXT,
        hash TEXT,
        version INTEGER DEFAULT 1,
        created_by INTEGER,
        updated_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME,
        FOREIGN KEY (folder_id) REFERENCES folders(id),
        FOREIGN KEY (space_id) REFERENCES spaces(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )`);

      // 文件版本表
      db.run(`CREATE TABLE IF NOT EXISTS file_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        hash TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      // 权限表（文件夹/文件级权限）
      db.run(`CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('folder', 'file', 'space')),
        resource_id INTEGER NOT NULL,
        user_id INTEGER,
        group_id INTEGER,
        permission_type TEXT NOT NULL CHECK(permission_type IN ('read', 'write', 'delete', 'comment', 'download')),
        granted_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (granted_by) REFERENCES users(id)
      )`);

      // 用户组表
      db.run(`CREATE TABLE IF NOT EXISTS user_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      // 用户组成员表
      db.run(`CREATE TABLE IF NOT EXISTS user_group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES user_groups(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(group_id, user_id)
      )`);

      // 外部分享表
      db.run(`CREATE TABLE IF NOT EXISTS external_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('file', 'folder')),
        resource_id INTEGER NOT NULL,
        share_token TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        allowed_emails TEXT,
        expires_at DATETIME,
        access_count INTEGER DEFAULT 0,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      // 分享访问记录表
      db.run(`CREATE TABLE IF NOT EXISTS share_access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_id INTEGER NOT NULL,
        access_ip TEXT,
        access_email TEXT,
        accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (share_id) REFERENCES external_shares(id)
      )`);

      // 评论表
      db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        mentioned_users TEXT,
        parent_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (parent_id) REFERENCES comments(id)
      )`);

      // 操作日志表
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
      )`);

      // 系统配置表
      db.run(`CREATE TABLE IF NOT EXISTS system_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT UNIQUE NOT NULL,
        config_value TEXT,
        description TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // 分块上传表（用于断点续传）
      db.run(`CREATE TABLE IF NOT EXISTS chunk_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        upload_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        mime_type TEXT,
        total_chunks INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        uploaded_chunks TEXT NOT NULL DEFAULT '[]',
        folder_id INTEGER,
        space_id INTEGER,
        status TEXT DEFAULT 'uploading' CHECK(status IN ('uploading', 'completed', 'failed', 'cancelled')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (folder_id) REFERENCES folders(id),
        FOREIGN KEY (space_id) REFERENCES spaces(id)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_chunk_uploads_user ON chunk_uploads(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_chunk_uploads_status ON chunk_uploads(status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_files_space ON files(space_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource_type, resource_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_logs_user ON operation_logs(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_logs_created ON operation_logs(created_at)`);

      db.run(`PRAGMA foreign_keys = ON`, (err) => {
        if (err) reject(err);
        else {
          console.log('数据表创建成功');
          resolve();
        }
      });
    });
  });
}

// 执行查询
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// 执行单条查询
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// 执行插入/更新/删除
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// 关闭数据库
function close() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  init,
  query,
  get,
  run,
  close
};

