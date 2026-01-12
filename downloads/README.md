# 桌面客户端安装程序

此目录用于存放桌面客户端的安装程序文件。

## 状态

✅ **前端构建已完成**

前端代码已成功构建，位于 `client/dist` 目录中。

⚠️ **Electron 应用构建待执行**

由于环境限制，Electron 应用安装程序需要手动构建。请参考 `BUILD_INSTRUCTIONS.md` 中的详细说明。

## 快速开始

### 1. 安装 electron-builder（如果尚未安装）

```bash
npm install electron-builder --save-dev
```

### 2. 构建安装程序

```bash
npm run electron:build
```

### 3. 复制安装程序

构建完成后，将 `dist-electron` 目录中的安装程序复制到此目录：

- **macOS**: `dist-electron/FileShare-1.0.0.dmg` → `downloads/FileShare.dmg`
- **Windows**: `dist-electron/FileShare Setup 1.0.0.exe` → `downloads/FileShare-Setup.exe`
- **Linux**: `dist-electron/FileShare-1.0.0.AppImage` → `downloads/FileShare.AppImage`

## 文件命名

请确保文件命名为：
- macOS: `FileShare.dmg`
- Windows: `FileShare-Setup.exe`
- Linux: `FileShare.AppImage`

这样工作台页面的下载链接才能正常工作。

## 详细说明

- **Windows 打包**：请查看 `BUILD_WINDOWS.md` 获取 Windows 版本的详细打包说明
- **完整说明**：请查看 `BUILD_INSTRUCTIONS.md` 获取所有平台的构建说明和注意事项

