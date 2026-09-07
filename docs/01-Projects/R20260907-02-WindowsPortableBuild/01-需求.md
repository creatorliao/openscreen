# Portable Build Requirement

## 需求描述

将当前 openscreen 项目构建为 Windows 上的 **portable（便携式）** 版本。

## 目标

构建产物放在一个独立的目录中：

```
dist/openscreen-portable-x.x.x/
```

用户只需：
1. 将该目录拷贝到任意位置
2. 在目录内直接双击可执行文件运行
3. 手工测试走查，验证所有功能可用

## 核心约束

- **无需安装**：不经过 NSIS 安装程序，无需注册表写入，无需管理员权限
- **独立目录**：所有依赖（Electron、原生 DLL、ffmpeg、onnxruntime 等）均打包在目录内
- **可移植**：目录可以移动到任意路径，仍可正常运行
- **Windows 平台**：目标平台 Windows x64

## 当前构建方式

当前 `build:win` 命令产出：
- NSIS 安装程序（`Openscreen.Setup.x.x.x.exe`）
- 输出到 `release/${version}/`

## 期望构建方式

增加 `build:win:portable` 命令，产出：
- 解压即用的 portable 目录
- 输出到 `dist/openscreen-portable-${version}/`

## 记录时间

2026-09-07
