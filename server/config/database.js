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
          createTables()
            .then(() => ensureChunkUploadsFileId())
            .then(() => ensureFilesDownloadCount())
            .then(() => ensureSpaceKind())
            .then(() => ensurePermissionsResourceType())
            .then(resolve)
            .catch(reject);
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

      // ==================== Wiki 知识库模块（v1.0.14） ====================
      // Wiki 页面（与 spaces.space_kind='wiki' 关联）
      db.run(`CREATE TABLE IF NOT EXISTS wiki_pages (
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
      )`);

      // Wiki 页面版本历史
      db.run(`CREATE TABLE IF NOT EXISTS wiki_page_versions (
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
      )`);

      // Wiki 标签
      db.run(`CREATE TABLE IF NOT EXISTS wiki_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#0d9488',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Wiki 页面-标签关联
      db.run(`CREATE TABLE IF NOT EXISTS wiki_page_tags (
        page_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY(page_id, tag_id),
        FOREIGN KEY (page_id) REFERENCES wiki_pages(id),
        FOREIGN KEY (tag_id) REFERENCES wiki_tags(id)
      )`);

      // Wiki 收藏
      db.run(`CREATE TABLE IF NOT EXISTS wiki_favorites (
        user_id INTEGER NOT NULL,
        page_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, page_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (page_id) REFERENCES wiki_pages(id)
      )`);

      // Wiki 浏览记录（明细，用于热门与个人最近浏览）
      db.run(`CREATE TABLE IF NOT EXISTS wiki_page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id INTEGER NOT NULL,
        user_id INTEGER,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip TEXT,
        FOREIGN KEY (page_id) REFERENCES wiki_pages(id)
      )`);

      // Wiki 页面内链
      db.run(`CREATE TABLE IF NOT EXISTS wiki_page_links (
        source_page_id INTEGER NOT NULL,
        target_page_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(source_page_id, target_page_id),
        FOREIGN KEY (source_page_id) REFERENCES wiki_pages(id),
        FOREIGN KEY (target_page_id) REFERENCES wiki_pages(id)
      )`);

      // Wiki 页面附件（关联 files 表，运行时复合权限校验）
      db.run(`CREATE TABLE IF NOT EXISTS wiki_page_attachments (
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
      )`);

      // Wiki 订阅（页面/知识库/标签）
      db.run(`CREATE TABLE IF NOT EXISTS wiki_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('page','space','tag')),
        target_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, target_type, target_id)
      )`);

      // Wiki 通知（前端红点）— @提及 / 订阅更新触发，不外发邮件/站内信
      db.run(`CREATE TABLE IF NOT EXISTS wiki_notifications (
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
      )`);

      // Wiki 评论（独立于 comments 表，避免破坏既有 file_id NOT NULL 约束）
      db.run(`CREATE TABLE IF NOT EXISTS wiki_comments (
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
      )`);
      // ==================== Wiki 模块结束 ====================

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
      // Wiki 模块索引
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_pages_space ON wiki_pages(space_id, deleted_at)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON wiki_pages(parent_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_pages_updated ON wiki_pages(updated_at DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_versions_page ON wiki_page_versions(page_id, version DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_views_page_time ON wiki_page_views(page_id, viewed_at DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_views_user_time ON wiki_page_views(user_id, viewed_at DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_attach_page ON wiki_page_attachments(page_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_subs_target ON wiki_subscriptions(target_type, target_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_comments_page ON wiki_comments(page_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_wiki_notifications_user_read ON wiki_notifications(user_id, read_at, created_at DESC)`);

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

// 为 chunk_uploads 表补全 file_id 列（完成上传时写入，兼容旧库）
async function ensureChunkUploadsFileId() {
  const rows = await query(`PRAGMA table_info(chunk_uploads)`);
  const hasFileId = rows && rows.some(r => r.name === 'file_id');
  if (!hasFileId) {
    await run(`ALTER TABLE chunk_uploads ADD COLUMN file_id INTEGER REFERENCES files(id)`);
    console.log('已为 chunk_uploads 表添加 file_id 列');
  }
}

// 为 files 表补全 download_count 列（下载次数，用于排行榜与详情展示）
async function ensureFilesDownloadCount() {
  const rows = await query(`PRAGMA table_info(files)`);
  const hasCol = rows && rows.some(r => r.name === 'download_count');
  if (!hasCol) {
    await run(`ALTER TABLE files ADD COLUMN download_count INTEGER DEFAULT 0`);
    console.log('已为 files 表添加 download_count 列');
  }
}

// Wiki v1.0.14：为 spaces 表补全 space_kind 列（区分文件空间 / Wiki 知识库）
async function ensureSpaceKind() {
  const rows = await query(`PRAGMA table_info(spaces)`);
  const hasCol = rows && rows.some(r => r.name === 'space_kind');
  if (!hasCol) {
    await run(`ALTER TABLE spaces ADD COLUMN space_kind TEXT DEFAULT 'file'`);
    // 老数据回填为 'file'，避免 NULL（DEFAULT 仅作用于后续 INSERT）
    await run(`UPDATE spaces SET space_kind = 'file' WHERE space_kind IS NULL`);
    console.log('已为 spaces 表添加 space_kind 列');
  }
}

// Wiki v1.0.14：permissions.resource_type CHECK 约束扩展支持 'wiki_page'
// SQLite 不支持 ALTER CHECK，需重建表迁移数据
async function ensurePermissionsResourceType() {
  // 通过尝试插入再删除一条 wiki_page 测试记录来检查 CHECK 约束（最快）
  // 更稳妥的做法：读 sqlite_master 中的表 SQL 文本判断是否包含 'wiki_page'
  const meta = await get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='permissions'`);
  if (!meta || !meta.sql) return;
  if (meta.sql.includes("'wiki_page'")) return; // 已支持

  console.log('正在迁移 permissions 表以支持 wiki_page 资源类型...');
  await run('PRAGMA foreign_keys = OFF');
  try {
    await run('BEGIN TRANSACTION');
    await run(`CREATE TABLE permissions_new (
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
    )`);
    await run(`INSERT INTO permissions_new (id, resource_type, resource_id, user_id, group_id, permission_type, granted_by, created_at)
               SELECT id, resource_type, resource_id, user_id, group_id, permission_type, granted_by, created_at FROM permissions`);
    await run(`DROP TABLE permissions`);
    await run(`ALTER TABLE permissions_new RENAME TO permissions`);
    await run(`CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource_type, resource_id)`);
    await run('COMMIT');
    console.log('permissions 表迁移完成（已支持 wiki_page）');
  } catch (e) {
    await run('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await run('PRAGMA foreign_keys = ON');
  }
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

// 执行事务：接收一个异步回调，在 BEGIN/COMMIT 中执行，失败自动 ROLLBACK
async function transaction(fn) {
  await run('BEGIN TRANSACTION');
  try {
    const result = await fn();
    await run('COMMIT');
    return result;
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
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
  transaction,
  close
};

