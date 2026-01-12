# Windows 客户端打包指南

## 前置要求

1. **Node.js 18+** 已安装
2. **所有依赖** 已安装：`npm install`
3. **electron-builder** 已安装：`npm install electron-builder --save-dev`

## Windows 打包命令

### 方法一：使用专用 Windows 构建脚本（推荐）

```bash
# 一键构建 Windows 安装程序（已配置跳过原生依赖）
npm run electron:build:win
```

### 方法二：使用标准构建命令

```bash
# 1. 构建前端
npm run client:build

# 2. 构建 Windows 安装程序（跳过 npm 重建）
npm run electron:build -- --win --config.npmRebuild=false
```

### 方法二：直接使用 electron-builder

```bash
# 1. 构建前端
npm run client:build

# 2. 仅构建 Windows 版本
npx electron-builder --win
```

或者使用本地安装的 electron-builder：

```bash
# 1. 构建前端
npm run client:build

# 2. 仅构建 Windows 版本
./node_modules/.bin/electron-builder --win
```

## 构建输出

构建完成后，Windows 应用将位于：

**便携式版本（当前配置）：**
```
dist-electron/FileShare-1.0.0.exe
```

**NSIS 安装程序（如果使用标准配置）：**
```
dist-electron/FileShare Setup 1.0.0.exe
```

## 复制到 downloads 目录

将构建好的应用复制到 downloads 目录并重命名：

**便携式版本：**
```bash
# Windows (PowerShell)
Copy-Item "dist-electron\FileShare-1.0.0.exe" "downloads\FileShare-Setup.exe"

# Windows (CMD)
copy "dist-electron\FileShare-1.0.0.exe" "downloads\FileShare-Setup.exe"

# macOS/Linux
cp dist-electron/FileShare-1.0.0.exe downloads/FileShare-Setup.exe
```

**NSIS 安装程序：**
```bash
# Windows (PowerShell)
Copy-Item "dist-electron\FileShare Setup 1.0.0.exe" "downloads\FileShare-Setup.exe"

# Windows (CMD)
copy "dist-electron\FileShare Setup 1.0.0.exe" "downloads\FileShare-Setup.exe"

# macOS/Linux
cp "dist-electron/FileShare Setup 1.0.0.exe" downloads/FileShare-Setup.exe
```

## 一键脚本（Windows PowerShell）

创建 `build-windows.ps1` 文件：

```powershell
# 构建前端
Write-Host "构建前端..." -ForegroundColor Green
npm run client:build

# 构建 Windows 安装程序
Write-Host "构建 Windows 安装程序..." -ForegroundColor Green
npm run electron:build -- --win

# 复制到 downloads 目录
Write-Host "复制安装程序..." -ForegroundColor Green
if (Test-Path "dist-electron\FileShare Setup 1.0.0.exe") {
    Copy-Item "dist-electron\FileShare Setup 1.0.0.exe" "downloads\FileShare-Setup.exe" -Force
    Write-Host "完成！安装程序已复制到 downloads/FileShare-Setup.exe" -ForegroundColor Green
} else {
    Write-Host "错误：未找到安装程序文件" -ForegroundColor Red
}
```

运行脚本：

```powershell
.\build-windows.ps1
```

## 一键脚本（macOS/Linux）

创建 `build-windows.sh` 文件：

```bash
#!/bin/bash

echo "构建前端..."
npm run client:build

echo "构建 Windows 安装程序..."
npm run electron:build -- --win

echo "复制安装程序..."
if [ -f "dist-electron/FileShare Setup 1.0.0.exe" ]; then
    cp "dist-electron/FileShare Setup 1.0.0.exe" downloads/FileShare-Setup.exe
    echo "完成！安装程序已复制到 downloads/FileShare-Setup.exe"
else
    echo "错误：未找到安装程序文件"
fi
```

运行脚本：

```bash
chmod +x build-windows.sh
./build-windows.sh
```

## 常见问题

### NSIS 资源下载失败

如果在构建时遇到以下错误：

```
⨯ Get "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z": EOF
```

这是网络连接问题，electron-builder 无法下载 Windows 构建工具。

#### 解决方案

**方案1：使用便携式安装程序（推荐，已配置）**

配置已更新为使用便携式安装程序（portable），不需要下载 NSIS 资源。构建后的文件是：
- `dist-electron/FileShare-1.0.0.exe` （便携式，无需安装）

复制命令：
```bash
cp dist-electron/FileShare-1.0.0.exe downloads/FileShare-Setup.exe
```

**方案2：使用代理或镜像**

```bash
# 设置代理
export HTTP_PROXY=http://your-proxy:port
export HTTPS_PROXY=http://your-proxy:port

# 然后重新构建
npm run electron:build:win
```

**方案3：在 Windows 机器上直接构建（最佳）**

在 Windows 机器上构建可以避免所有网络和交叉编译问题：

```powershell
npm run client:build
npm run electron:build -- --win
```

**方案4：手动下载 NSIS 资源**

如果必须使用 NSIS 安装程序，可以：

1. 手动下载：https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z
2. 放置到：`~/.cache/electron-builder/nsis-resources/` 目录
3. 重新运行构建

### sqlite3 构建失败

如果在 macOS/Linux 上交叉编译 Windows 版本时遇到 sqlite3 构建失败，这是因为：

1. **Electron 客户端不需要服务器代码**：sqlite3 是服务器端的依赖，Electron 客户端不需要它
2. **已修复**：electron-builder 配置已更新，排除了 server 目录

如果仍然遇到问题，可以尝试：

```bash
# 方法1：使用 --skip-native-deps 跳过原生依赖
npm run electron:build -- --win --skip-native-deps

# 方法2：在 Windows 机器上直接构建（推荐）
# 这样可以避免交叉编译的问题
```

### 网络问题

如果下载预构建二进制文件超时，可以：

1. 使用代理或 VPN
2. 在 Windows 机器上直接构建
3. 使用国内镜像源

## 注意事项

1. **构建时间**：首次构建可能需要较长时间，请耐心等待
2. **文件大小**：Windows 安装程序通常为 100-200MB
3. **代码签名**：生产环境建议进行代码签名（需要证书）
4. **NSIS 安装程序**：默认使用 NSIS 创建安装程序
5. **目标架构**：默认构建 x64 版本，如需 x86 版本，使用 `--win --ia32`
6. **推荐在 Windows 上构建**：在 Windows 机器上直接构建可以避免交叉编译的问题

## 验证

构建完成后，检查文件是否存在：

```bash
# Windows
dir downloads\FileShare-Setup.exe

# macOS/Linux
ls -lh downloads/FileShare-Setup.exe
```

如果文件存在，访问工作台页面，点击"下载 Windows 版本"按钮应该能够正常下载。

