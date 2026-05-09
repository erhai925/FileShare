#!/usr/bin/env node

/**
 * 数据库 schema 迁移脚本
 * 用于升级时同步数据库结构，确保所有表、索引与 database.js 一致
 * 使用 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS，幂等安全
 *
 * 用法：
 *   node server/scripts/migrate-schema.js [dbPath]
 *   dbPath 默认使用环境变量 DB_PATH 或 ./data/fileshare.db
 *
 * 或在升级脚本中：
 *   const { runMigrations } = require('../server/scripts/migrate-schema');
 *   await runMigrations(dbPath);
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const SCHEMA_STATEMENTS = [
  // 表（与 database.js 保持一致）
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,
  `CREATE TABLE IF NOT EXISTS spaces (
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
  )`,
  `CREATE TABLE IF NOT EXISTS folders (
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
  )`,
  `CREATE TABLE IF NOT EXISTS files (
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
  )`,
  `CREATE TABLE IF NOT EXISTS file_versions (
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
  )`,
  `CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('folder', 'file', 'space', 'wiki_page')),
    resource_id INTEGER NOT NULL,
    user_id INTEGER,
    group_id INTEGER,
    permission_type TEXT NOT NULL CHECK(permission_type IN ('read', 'write', 'delete', 'comment', 'download')),
    granted_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (granted_by) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES user_groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS external_shares (
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
  )`,
  `CREATE TABLE IF NOT EXISTS share_access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL,
    access_ip TEXT,
    access_email TEXT,
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (share_id) REFERENCES external_shares(id)
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
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
  )`,
  `CREATE TABLE IF NOT EXISTS operation_logs (
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
  )`,
  `CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT UNIQUE NOT NULL,
    config_value TEXT,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS chunk_uploads (
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
  )`,
  // ==================== Wiki 模块（v1.0.14） ====================
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL,
    parent_id INTEGER,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    content TEXT,
    content_text TEXT,
    draft_content TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','published')),
    template TEXT DEFAULT 'blank',
    sort_order INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    archived_at DATETIME,
    created_by INTEGER NOT NULL,
    updated_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY (space_id) REFERENCES spaces(id),
    FOREIGN KEY (parent_id) REFERENCES wiki_pages(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id),
    UNIQUE(space_id, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    change_note TEXT,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (page_id) REFERENCES wiki_pages(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    UNIQUE(page_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#0d9488',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_tags (
    page_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY(page_id, tag_id),
    FOREIGN KEY (page_id) REFERENCES wiki_pages(id),
    FOREIGN KEY (tag_id) REFERENCES wiki_tags(id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_favorites (
    user_id INTEGER NOT NULL,
    page_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, page_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (page_id) REFERENCES wiki_pages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL,
    user_id INTEGER,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip TEXT,
    FOREIGN KEY (page_id) REFERENCES wiki_pages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_links (
    source_page_id INTEGER NOT NULL,
    target_page_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(source_page_id, target_page_id),
    FOREIGN KEY (source_page_id) REFERENCES wiki_pages(id),
    FOREIGN KEY (target_page_id) REFERENCES wiki_pages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_page_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (page_id) REFERENCES wiki_pages(id),
    FOREIGN KEY (file_id) REFERENCES files(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    UNIQUE(page_id, file_id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('page','space','tag')),
    target_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, target_type, target_id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('mention','subscription_update')),
    target_type TEXT NOT NULL CHECK(target_type IN ('page','space','tag')),
    target_id INTEGER NOT NULL,
    actor_id INTEGER,
    payload TEXT,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (actor_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    mentioned_users TEXT,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (page_id) REFERENCES wiki_pages(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES wiki_comments(id)
  )`,
  // 索引
  `CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunk_uploads_user ON chunk_uploads(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunk_uploads_status ON chunk_uploads(status)`,
  `CREATE INDEX IF NOT EXISTS idx_files_space ON files(space_id)`,
  `CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource_type, resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_user ON operation_logs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_created ON operation_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_pages_space ON wiki_pages(space_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON wiki_pages(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_pages_updated ON wiki_pages(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_versions_page ON wiki_page_versions(page_id, version DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_views_page_time ON wiki_page_views(page_id, viewed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_views_user_time ON wiki_page_views(user_id, viewed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_attach_page ON wiki_page_attachments(page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_subs_target ON wiki_subscriptions(target_type, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_comments_page ON wiki_comments(page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_notifications_user_read ON wiki_notifications(user_id, read_at, created_at DESC)`
];

/**
 * 执行数据库 schema 迁移
 * @param {string} dbPath - 数据库文件路径
 * @returns {Promise<void>}
 */
function runMigrations(dbPath) {
  return new Promise((resolve, reject) => {
    const resolvedPath = path.resolve(dbPath);
    const db = new sqlite3.Database(resolvedPath, (err) => {
      if (err) {
        return reject(err);
      }
    });

    let completed = 0;
    const total = SCHEMA_STATEMENTS.length;

    function runNext(index) {
      if (index >= total) {
        db.run('PRAGMA foreign_keys = ON', (err) => {
          db.close((closeErr) => {
            if (closeErr) reject(closeErr);
            else if (err) reject(err);
            else resolve();
          });
        });
        return;
      }

      db.run(SCHEMA_STATEMENTS[index], (err) => {
        if (err) {
          db.close();
          return reject(new Error(`迁移失败 [${index + 1}/${total}]: ${err.message}`));
        }
        completed++;
        runNext(index + 1);
      });
    }

    runNext(0);
  });
}

if (require.main === module) {
  require('dotenv').config();
  const dbPath = process.argv[2] || process.env.DB_PATH || './data/fileshare.db';
  runMigrations(dbPath)
    .then(() => {
      console.log('数据库 schema 迁移完成');
      process.exit(0);
    })
    .catch((err) => {
      console.error('迁移失败:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations, SCHEMA_STATEMENTS };
