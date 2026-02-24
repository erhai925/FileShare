# Windows 构建问题排查

## sqlite3 构建失败

### 问题描述

在 macOS/Linux 上交叉编译 Windows 版本时，可能会遇到以下错误：

```
⨯ cannot build native dependency
reason=prebuild-install failed with error
prebuild-install warn install Request timed out
```

### 原因

1. **sqlite3 是服务器端依赖**：Electron 客户端不需要 sqlite3，它只在服务器端使用
2. **交叉编译限制**：在 macOS/Linux 上为 Windows 构建原生模块时，需要下载预构建的二进制文件
3. **网络问题**：下载预构建二进制文件可能超时

### 解决方案

#### 方案1：已修复配置（推荐）

electron-builder 配置已更新，排除了 server 目录。如果仍然遇到问题，请确保使用最新配置。

#### 方案2：跳过原生依赖

```bash
npm run electron:build -- --win --skip-native-deps
```

#### 方案3：在 Windows 上直接构建（最佳）

在 Windows 机器上直接构建可以完全避免交叉编译的问题：

```powershell
# 在 Windows PowerShell 中
npm run client:build
npm run electron:build -- --win
```

#### 方案4：使用代理或镜像

如果网络问题导致下载失败：

```bash
# 设置 npm 镜像
npm config set registry https://registry.npmmirror.com

# 或使用代理
export HTTP_PROXY=http://your-proxy:port
export HTTPS_PROXY=http://your-proxy:port
```

#### 方案5：手动安装 sqlite3 Windows 二进制

如果必须包含 sqlite3，可以尝试：

```bash
# 安装 Windows 版本的 sqlite3
npm install sqlite3 --target_platform=win32 --target_arch=x64
```

## 其他常见问题

### 1. electron-builder 未找到

```bash
npm install electron-builder --save-dev
```

### 2. 构建时间过长

首次构建需要下载 Electron 二进制文件，可能需要较长时间。请耐心等待。

### 3. 权限问题

确保有写入 `dist-electron` 目录的权限。

### 4. 磁盘空间不足

确保有足够的磁盘空间（至少 2GB）。

## 验证构建

构建成功后，检查文件：

```bash
# Windows
dir dist-electron\*.exe

# macOS/Linux
ls -lh dist-electron/*.exe
```

如果文件存在，说明构建成功。


