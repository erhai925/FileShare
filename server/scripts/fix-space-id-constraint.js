/**
 * 修复 files 表的 space_id 约束
 * 将 space_id 从 NOT NULL 改为允许 NULL
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/fileshare.db';

async function fixConstraint() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('数据库连接失败:', err);
        reject(err);
        return;
      }

      console.log('开始修复 space_id 约束...');

      // 检查表是否存在
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='files'", (err, row) => {
        if (err) {
          console.error('检查表失败:', err);
          db.close();
          reject(err);
          return;
        }

        if (!row) {
          console.log('files 表不存在，无需修复');
          db.close();
          resolve();
          return;
        }

        // 检查 space_id 是否已经是可空的
        db.all("PRAGMA table_info(files)", (err, columns) => {
          if (err) {
            console.error('获取表结构失败:', err);
            db.close();
            reject(err);
            return;
          }

          const spaceIdColumn = columns.find(col => col.name === 'space_id');
          if (spaceIdColumn && spaceIdColumn.notnull === 0) {
            console.log('space_id 已经是可空的，无需修复');
            db.close();
            resolve();
            return;
          }

          console.log('开始迁移数据...');

          // SQLite 不支持直接修改列约束，需要重建表
          db.serialize(() => {
            // 1. 创建新表（允许 space_id 为 NULL）
            db.run(`CREATE TABLE files_new (
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
            )`, (err) => {
              if (err) {
                console.error('创建新表失败:', err);
                db.close();
                reject(err);
                return;
              }

              console.log('新表创建成功');

              // 2. 复制数据
              db.run(`INSERT INTO files_new SELECT * FROM files`, (err) => {
                if (err) {
                  console.error('复制数据失败:', err);
                  db.run('DROP TABLE files_new', () => {});
                  db.close();
                  reject(err);
                  return;
                }

                console.log('数据复制成功');

                // 3. 删除旧表
                db.run(`DROP TABLE files`, (err) => {
                  if (err) {
                    console.error('删除旧表失败:', err);
                    db.close();
                    reject(err);
                    return;
                  }

                  console.log('旧表删除成功');

                  // 4. 重命名新表
                  db.run(`ALTER TABLE files_new RENAME TO files`, (err) => {
                    if (err) {
                      console.error('重命名表失败:', err);
                      db.close();
                      reject(err);
                      return;
                    }

                    console.log('✅ space_id 约束修复成功！');
                    db.close();
                    resolve();
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

// 执行修复
fixConstraint()
  .then(() => {
    console.log('修复完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('修复失败:', error);
    process.exit(1);
  });





