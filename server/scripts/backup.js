const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');

async function backup() {
  try {
    const backupDir = path.join(process.cwd(), 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupName = `backup-${timestamp}`;
    const backupPath = path.join(backupDir, backupName);
    
    console.log(`开始备份到: ${backupPath}.zip`);
    
    // 创建ZIP文件
    const output = require('fs').createWriteStream(`${backupPath}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`备份完成！文件大小: ${archive.pointer()} 字节`);
      process.exit(0);
    });
    
    archive.on('error', (err) => {
      console.error('备份失败:', err);
      process.exit(1);
    });
    
    archive.pipe(output);
    
    // 备份数据库
    const dbPath = process.env.DB_PATH || './data/fileshare.db';
    if (await fs.access(dbPath).then(() => true).catch(() => false)) {
      archive.file(dbPath, { name: 'fileshare.db' });
    }
    
    // 备份存储文件（可选，如果文件很大可能不需要）
    const { getStoragePath } = require('../utils/storage');
    const storagePath = await getStoragePath();
    if (await fs.access(storagePath).then(() => true).catch(() => false)) {
      archive.directory(storagePath, 'storage');
    }
    
    await archive.finalize();
  } catch (error) {
    console.error('备份失败:', error);
    process.exit(1);
  }
}

backup();

