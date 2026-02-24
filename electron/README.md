# FileShare Electron 桌面客户端

## 开发

### 前置要求
- Node.js 18+
- 已安装项目依赖

### 启动开发环境

1. 确保后端服务器正在运行（端口3000）
2. 确保前端开发服务器正在运行（端口5173）
3. 启动Electron应用：

```bash
npm run electron:dev
```

## 构建

### 构建应用

```bash
# 构建前端
npm run client:build

# 打包Electron应用
npm run electron:pack

# 构建安装包
npm run electron:build
```

## 功能特性

- ✅ 系统托盘支持
- ✅ 本地文件选择对话框
- ✅ 本地文件夹选择对话框
- ✅ 文件保存对话框
- ✅ 窗口最小化到托盘
- ✅ 应用菜单

## 平台支持

- ✅ macOS
- ✅ Windows
- ✅ Linux

## 注意事项

1. 开发环境下，Electron会连接到 `http://localhost:5173`
2. 生产环境下，Electron会加载构建后的前端文件
3. 确保后端API地址配置正确（在 `client/src/services/api.ts` 中）



