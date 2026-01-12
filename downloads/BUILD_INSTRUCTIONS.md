# 构建桌面客户端安装程序

## 前置要求

1. 确保已安装 Node.js 18+
2. 确保已安装所有依赖：`npm install`
3. 确保 electron-builder 已安装：`npm install electron-builder --save-dev`

## 构建步骤

### 1. 构建前端

```bash
npm run client:build
```

### 2. 构建 Electron 应用

```bash
npm run electron:build
```

或者分步执行：

```bash
# 构建前端
npm run client:build

# 构建安装程序
npx electron-builder
```

### 3. 复制安装程序到 downloads 目录

构建完成后，安装程序将位于 `dist-electron` 目录中。请根据您的操作系统复制相应的文件：

#### macOS
```bash
cp dist-electron/FileShare-1.0.0.dmg downloads/FileShare.dmg
```

#### Windows
```bash
cp "dist-electron/FileShare Setup 1.0.0.exe" downloads/FileShare-Setup.exe
```

#### Linux
```bash
cp dist-electron/FileShare-1.0.0.AppImage downloads/FileShare.AppImage
```

## 注意事项

1. 构建过程可能需要一些时间，请耐心等待
2. macOS 构建需要代码签名（可选，但推荐用于分发）
3. Windows 构建会生成 NSIS 安装程序
4. Linux 构建会生成 AppImage 文件

## 验证

构建完成后，访问工作台页面，点击下载按钮应该能够正常下载安装程序。


