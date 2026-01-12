# FileShare 部署指南

## 一、环境要求

### 服务器要求
- **操作系统**: Linux (CentOS 7+, Ubuntu 18.04+) 或 Windows Server 2016+
- **Node.js**: >= 16.0.0
- **npm**: >= 8.0.0
- **内存**: >= 2GB
- **磁盘空间**: 根据文件存储需求（建议至少50GB）

### 推荐配置
- CPU: 2核心及以上
- 内存: 4GB及以上
- 磁盘: SSD，100GB及以上

## 二、Linux部署（CentOS/Ubuntu）

### 1. 安装Node.js

#### Ubuntu/Debian
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### CentOS/RHEL
```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

### 2. 克隆或上传项目

```bash
# 如果使用Git
git clone <repository-url>
cd FileShare

# 或直接上传项目文件到服务器
```

### 3. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd client
npm install
cd ..
```

### 4. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置文件
nano .env
```

**重要配置项：**
```env
# 修改JWT密钥（必须修改为强随机字符串）
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# 修改加密密钥（必须修改为32字符）
ENCRYPTION_KEY=your-32-character-encryption-key-here

# 配置端口
PORT=3000

# 配置存储路径
STORAGE_PATH=/var/fileshare/storage
```

### 5. 初始化数据库

```bash
npm run init
```

这将创建数据库表并创建默认管理员账户：
- 用户名: `admin`
- 密码: `admin123`

**⚠️ 首次登录后请立即修改密码！**

### 6. 构建前端

```bash
cd client
npm run build
cd ..
```

### 7. 使用PM2运行（推荐）

```bash
# 安装PM2
npm install -g pm2

# 启动服务
pm2 start server/index.js --name fileshare

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status

# 查看日志
pm2 logs fileshare
```

### 8. 配置Nginx反向代理（可选但推荐）

安装Nginx：
```bash
# Ubuntu/Debian
sudo apt-get install nginx

# CentOS
sudo yum install nginx
```

配置Nginx：
```bash
sudo nano /etc/nginx/sites-available/fileshare
```

添加配置：
```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为您的域名或IP

    # 前端静态文件
    location / {
        root /path/to/FileShare/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

启用配置：
```bash
# Ubuntu/Debian
sudo ln -s /etc/nginx/sites-available/fileshare /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# CentOS
sudo cp /etc/nginx/sites-available/fileshare /etc/nginx/conf.d/fileshare.conf
sudo nginx -t
sudo systemctl restart nginx
```

### 9. 配置HTTPS（推荐）

使用Let's Encrypt免费SSL证书：

```bash
# 安装Certbot
sudo apt-get install certbot python3-certbot-nginx  # Ubuntu
sudo yum install certbot python3-certbot-nginx     # CentOS

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期（已自动配置）
sudo certbot renew --dry-run
```

## 三、Windows Server部署

### 1. 安装Node.js

从 [Node.js官网](https://nodejs.org/) 下载Windows安装包并安装。

### 2. 安装项目依赖

在项目目录打开PowerShell：
```powershell
npm install
cd client
npm install
cd ..
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并编辑配置。

### 4. 初始化数据库

```powershell
npm run init
```

### 5. 构建前端

```powershell
cd client
npm run build
cd ..
```

### 6. 运行服务

#### 方式1：使用PM2（推荐）
```powershell
npm install -g pm2
pm2 start server/index.js --name fileshare
```

#### 方式2：使用Windows服务
可以使用 [node-windows](https://github.com/coreybutler/node-windows) 将Node.js应用注册为Windows服务。

#### 方式3：直接运行
```powershell
npm run server:start
```

## 四、防火墙配置

### Linux (firewalld)
```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

### Linux (ufw)
```bash
sudo ufw allow 3000/tcp
sudo ufw reload
```

### Windows
在Windows防火墙中允许端口3000的入站连接。

## 五、数据备份

### 手动备份
```bash
npm run backup
```

备份文件将保存在 `backups/` 目录。

### 自动备份（Linux Cron）

编辑crontab：
```bash
crontab -e
```

添加定时任务（每天凌晨2点备份）：
```
0 2 * * * cd /path/to/FileShare && npm run backup
```

## 六、系统维护

### 清理过期日志
系统会自动清理90天前的日志，也可手动执行：
```bash
# 在管理后台执行清理操作
```

### 清理回收站
在管理后台可以手动清理回收站，或配置自动清理。

### 监控系统资源
```bash
# 查看PM2进程
pm2 monit

# 查看系统资源
htop  # 或 top
```

## 七、故障排查

### 1. 服务无法启动
- 检查端口是否被占用：`netstat -tulpn | grep 3000`
- 查看日志：`pm2 logs fileshare` 或 `npm run server:dev`
- 检查环境变量配置是否正确

### 2. 数据库错误
- 检查数据库文件权限
- 确保数据目录存在且有写权限
- 重新初始化：`npm run init`（会清空数据，谨慎操作）

### 3. 文件上传失败
- 检查存储目录权限
- 检查磁盘空间：`df -h`
- 检查文件大小限制配置

### 4. 前端无法访问
- 检查前端是否已构建：`ls client/dist`
- 检查Nginx配置
- 检查浏览器控制台错误

## 八、性能优化

### 1. 启用Gzip压缩
已在代码中启用，无需额外配置。

### 2. 数据库优化
SQLite适合小团队，如需要更高性能可迁移到PostgreSQL。

### 3. 文件存储优化
- 使用SSD存储
- 定期清理过期版本和回收站
- 考虑使用对象存储（如MinIO）作为后端存储

## 九、安全建议

1. **修改默认密码**：首次登录后立即修改管理员密码
2. **使用HTTPS**：生产环境必须启用HTTPS
3. **定期备份**：配置自动备份
4. **更新依赖**：定期更新npm包以修复安全漏洞
5. **限制访问**：使用防火墙限制访问IP
6. **监控日志**：定期查看操作日志，发现异常行为

## 十、升级指南

1. 备份数据：`npm run backup`
2. 停止服务：`pm2 stop fileshare`
3. 更新代码：`git pull` 或上传新版本
4. 安装依赖：`npm install && cd client && npm install && cd ..`
5. 运行迁移脚本（如有）
6. 构建前端：`cd client && npm run build && cd ..`
7. 启动服务：`pm2 restart fileshare`

## 技术支持

如遇到问题，请查看：
- 操作日志：管理后台 > 操作日志
- 系统日志：`pm2 logs fileshare`
- 项目文档：`docs/` 目录





