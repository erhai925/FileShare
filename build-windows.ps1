# Windows 客户端打包脚本 (PowerShell)

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "开始构建 Windows 客户端" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. 构建前端
Write-Host ""
Write-Host "步骤 1/3: 构建前端..." -ForegroundColor Yellow
npm run client:build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 前端构建失败" -ForegroundColor Red
    exit 1
}

Write-Host "✅ 前端构建完成" -ForegroundColor Green

# 2. 构建 Windows 安装程序
Write-Host ""
Write-Host "步骤 2/3: 构建 Windows 安装程序..." -ForegroundColor Yellow
Write-Host "使用专用 Windows 构建脚本（已配置跳过原生依赖）" -ForegroundColor Cyan
npm run electron:build:win

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Windows 安装程序构建失败" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Windows 安装程序构建完成" -ForegroundColor Green

# 3. 复制到 downloads 目录
Write-Host ""
Write-Host "步骤 3/3: 复制安装程序到 downloads 目录..." -ForegroundColor Yellow

# 检查便携式版本（优先）
if (Test-Path "dist-electron\FileShare-1.0.0.exe") {
    if (-not (Test-Path "downloads")) {
        New-Item -ItemType Directory -Path "downloads" | Out-Null
    }
    
    Copy-Item "dist-electron\FileShare-1.0.0.exe" "downloads\FileShare-Setup.exe" -Force
    Write-Host "✅ 便携式应用已复制到 downloads\FileShare-Setup.exe" -ForegroundColor Green
# 检查 NSIS 安装程序
} elseif (Test-Path "dist-electron\FileShare Setup 1.0.0.exe") {
    if (-not (Test-Path "downloads")) {
        New-Item -ItemType Directory -Path "downloads" | Out-Null
    }
    
    Copy-Item "dist-electron\FileShare Setup 1.0.0.exe" "downloads\FileShare-Setup.exe" -Force
    Write-Host "✅ 安装程序已复制到 downloads\FileShare-Setup.exe" -ForegroundColor Green
    
    # 显示文件信息
    $file = Get-Item "downloads\FileShare-Setup.exe"
    Write-Host "文件大小: $([math]::Round($file.Length / 1MB, 2)) MB" -ForegroundColor Cyan
    
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "✅ Windows 客户端构建完成！" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "安装程序位置: downloads\FileShare-Setup.exe" -ForegroundColor Yellow
    Write-Host "现在可以在工作台页面下载 Windows 版本了" -ForegroundColor Yellow
} else {
    Write-Host "❌ 错误：未找到安装程序文件" -ForegroundColor Red
    Write-Host "请检查 dist-electron 目录" -ForegroundColor Red
    exit 1
}

