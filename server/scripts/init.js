const db = require('../config/database');
const bcrypt = require('bcryptjs');

async function init() {
  try {
    console.log('开始初始化数据库...');
    
    // 初始化数据库
    await db.init();
    
    // 检查是否已有管理员
    const admin = await db.get("SELECT * FROM users WHERE role = 'admin'");
    
    if (!admin) {
      console.log('创建默认管理员账户...');
      const passwordHash = await bcrypt.hash('admin123', 10);
      
      await db.run(
        `INSERT INTO users (username, email, password_hash, real_name, role)
         VALUES (?, ?, ?, ?, ?)`,
        ['admin', 'admin@fileshare.local', passwordHash, '系统管理员', 'admin']
      );
      
      console.log('默认管理员账户创建成功！');
      console.log('用户名: admin');
      console.log('密码: admin123');
      console.log('⚠️  请登录后立即修改密码！');
    } else {
      console.log('管理员账户已存在，跳过创建');
    }
    
    // 初始化系统配置
    const configs = [
      { key: 'version_retention_days', value: '30', description: '版本保留天数' },
      { key: 'trash_retention_days', value: '30', description: '回收站保留天数' },
      { key: 'log_retention_days', value: '90', description: '日志保留天数' },
      { key: 'max_file_size', value: '10737418240', description: '最大文件大小（字节）' },
      { key: 'file_naming_rule', value: '', description: '文件命名规则（正则表达式）' }
    ];
    
    for (const config of configs) {
      const existing = await db.get(
        'SELECT * FROM system_config WHERE config_key = ?',
        [config.key]
      );
      
      if (!existing) {
        await db.run(
          `INSERT INTO system_config (config_key, config_value, description)
           VALUES (?, ?, ?)`,
          [config.key, config.value, config.description]
        );
      }
    }
    
    console.log('系统配置初始化完成');
    console.log('数据库初始化完成！');
    
    process.exit(0);
  } catch (error) {
    console.error('初始化失败:', error);
    process.exit(1);
  }
}

init();





