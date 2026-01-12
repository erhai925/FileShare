#!/bin/bash

# Windows 客户端打包脚本

echo "========================================="
echo "开始构建 Windows 客户端"
echo "========================================="

# 1. 构建前端
echo ""
echo "步骤 1/3: 构建前端..."
npm run client:build

if [ $? -ne 0 ]; then
    echo "❌ 前端构建失败"
    exit 1
fi

echo "✅ 前端构建完成"

# 2. 构建 Windows 安装程序
echo ""
echo "步骤 2/3: 构建 Windows 安装程序..."
echo "使用专用 Windows 构建脚本（已配置跳过原生依赖）"
npm run electron:build:win

if [ $? -ne 0 ]; then
    echo "❌ Windows 安装程序构建失败"
    exit 1
fi

echo "✅ Windows 安装程序构建完成"

# 3. 复制到 downloads 目录
echo ""
echo "步骤 3/3: 复制安装程序到 downloads 目录..."

# 检查便携式版本（优先）
if [ -f "dist-electron/FileShare-1.0.0.exe" ]; then
    mkdir -p downloads
    cp dist-electron/FileShare-1.0.0.exe downloads/FileShare-Setup.exe
    echo "✅ 便携式应用已复制到 downloads/FileShare-Setup.exe"
# 检查 NSIS 安装程序
elif [ -f "dist-electron/FileShare Setup 1.0.0.exe" ]; then
    mkdir -p downloads
    cp "dist-electron/FileShare Setup 1.0.0.exe" downloads/FileShare-Setup.exe
    echo "✅ 安装程序已复制到 downloads/FileShare-Setup.exe"
    
    # 显示文件信息
    ls -lh downloads/FileShare-Setup.exe
    
    echo ""
    echo "========================================="
    echo "✅ Windows 客户端构建完成！"
    echo "========================================="
    echo "安装程序位置: downloads/FileShare-Setup.exe"
    echo "现在可以在工作台页面下载 Windows 版本了"
else
    echo "❌ 错误：未找到安装程序文件"
    echo "请检查 dist-electron 目录"
    exit 1
fi

