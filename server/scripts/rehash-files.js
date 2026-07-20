#!/usr/bin/env node

/**
 * 重算 files.hash，把历史上混用的哈希算法统一为 SHA-256
 *
 * 背景：普通上传曾用 SM3（encryption.js 的 generateHash），分块上传用
 * SHA-256（encryptFileStreaming 的流式哈希）。两者都是 64 位 hex，从值本身
 * 分辨不出算法，导致同一份文件经不同路径得到不同哈希，按哈希去重必然漏判。
 * generateHash 已统一为 SHA-256，本脚本负责回填存量记录。
 *
 * 范围限制（有意为之，不要误以为已全部覆盖）：
 *   只处理 files 表。file_versions.hash 同样可能混用算法，本脚本不动它，
 *   因为去重只比对 files.hash。若将来有功能要比对版本哈希，需另行回填。
 *
 * 用法：
 *   node server/scripts/rehash-files.js            # dry-run，只报告不写库
 *   node server/scripts/rehash-files.js --apply    # 实际写库
 *   node server/scripts/rehash-files.js --apply --include-deleted
 *
 * ⚠️ --apply 会修改数据库，执行前请先独立备份：
 *   cp data/fileshare.db data/fileshare.db.prebackup-$(date +%Y%m%d-%H%M%S)
 */

// 必须先于 utils/encryption 加载：该模块在 require 时即读取 ENCRYPTION_MODE，
// 不载入 .env 会退化成明文模式，在加密部署上把密文当明文算哈希，静默算错。
require('dotenv').config();

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { decryptFile, getEncryptionMode } = require('../utils/encryption');

const APPLY = process.argv.includes('--apply');
const INCLUDE_DELETED = process.argv.includes('--include-deleted');
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'fileshare.db');

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => (err ? reject(err) : resolve(db)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this);
    });
  });
}

/** 读取存储文件并还原为明文后计算 SHA-256（与上传时的口径一致：哈希始终算明文） */
async function hashStoredFile(filePath) {
  const raw = await fs.readFile(filePath);
  let plain = decryptFile(raw);
  if (plain instanceof Promise) plain = await plain;
  if (!Buffer.isBuffer(plain)) plain = Buffer.from(plain);
  return crypto.createHash('sha256').update(plain).digest('hex');
}

async function main() {
  console.log(`数据库：${DB_PATH}`);
  console.log(`加密模式：${getEncryptionMode() || 'none'}`);
  console.log(`模式：${APPLY ? '⚠️  APPLY（将写库）' : 'dry-run（只报告，不写库）'}`);
  console.log('');

  const db = await openDb();
  const where = INCLUDE_DELETED ? '' : 'WHERE deleted_at IS NULL';
  const rows = await all(db, `SELECT id, original_name, file_path, hash FROM files ${where} ORDER BY id`);

  let unchanged = 0, updated = 0, missing = 0, failed = 0;
  const changes = [];

  for (const r of rows) {
    let fresh;
    try {
      fresh = await hashStoredFile(r.file_path);
    } catch (e) {
      if (e.code === 'ENOENT') {
        missing++;
        console.warn(`[缺失] id=${r.id} ${r.original_name} -> ${r.file_path}`);
      } else {
        failed++;
        console.error(`[失败] id=${r.id} ${r.original_name}: ${e.message}`);
      }
      continue;
    }

    if (fresh === r.hash) {
      unchanged++;
      continue;
    }
    changes.push({ id: r.id, name: r.original_name, from: r.hash, to: fresh });
    if (APPLY) {
      await run(db, 'UPDATE files SET hash = ? WHERE id = ?', [fresh, r.id]);
    }
    updated++;
  }

  console.log('');
  console.log('—— 结果 ——');
  console.log(`扫描        ${rows.length}`);
  console.log(`已是 SHA256 ${unchanged}`);
  console.log(`${APPLY ? '已更新    ' : '待更新    '}  ${updated}`);
  console.log(`文件缺失    ${missing}`);
  console.log(`读取失败    ${failed}`);

  if (changes.length) {
    console.log('');
    console.log('—— 变更明细（前 20 条）——');
    for (const c of changes.slice(0, 20)) {
      console.log(`id=${c.id} ${c.name}\n  ${c.from} -> ${c.to}`);
    }
    if (changes.length > 20) console.log(`… 另有 ${changes.length - 20} 条`);
  }

  if (!APPLY && updated > 0) {
    console.log('');
    console.log('这是 dry-run。确认无误后，先备份数据库再加 --apply 重跑：');
    console.log('  cp data/fileshare.db data/fileshare.db.prebackup-$(date +%Y%m%d-%H%M%S)');
    console.log('  node server/scripts/rehash-files.js --apply');
  }

  db.close();
  // 缺失/失败视为需要人工介入，用非零退出码提示调用方
  process.exit(missing + failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('执行失败:', e);
  process.exit(1);
});
