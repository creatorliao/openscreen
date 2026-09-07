# Portable Build 解决方案

## 方案概述

使用 electron-builder 的 `dir` 目标，产出一个可直接双击运行的解压目录，输出到 `dist/openscreen-portable-${version}/`。

## 变更清单

### 变更 1：`package.json` — 新增 `build:win:portable` script

```json
"build:win:portable": "npm run build:native:win && npm run fetch:ffmpeg && npm run fetch:onnxruntime && npm run stage:vcomp && npm run build:native:compositor && tsc && vite build && electron-builder --win dir --config.directories.output=\"dist/openscreen-portable-${version}\" --config.npmRebuild=false"
```

**注意**：`${version}` 是 electron-builder 的模板变量（由 `package.json#version` 展开），而非 shell 变量。

### 变更 2：`electron-builder.json5` — 新增 `portable` 配置段

```json5
"portable": {
  // Artifact name for the Windows portable build.
  // electron-builder uses ${productName} and ${version} from package.json.
  "artifactName": "${productName}-Portable-${version}-win.${ext}"
}
```

> 注意：`portable` 在 `dir` 目标下是元数据配置节，`artifactName` 控制产出目录名。

## 实施细节

### 为什么用 `dir` 而不是 `portable`（NSIS portable .exe）？

| 对比维度 | `dir` 目标 | `portable` 目标（NSIS） |
|---------|-----------|----------------------|
| 用户操作 | 双击 `Openscreen.exe` | 双击单个 `.exe`，等待解压 |
| 启动速度 | 正常（无解压）| 慢（每次启动解压 ~200MB）|
| 目录结构 | 清晰可见 | 隐藏在 `%TEMP%` 中 |
| 可移动性 | 直接移动目录 | 移动单文件 |
| 测试走查 | **最适合**（直接看到所有文件）| 较难定位问题 |

### 命令行覆盖 vs 修改 `electron-builder.json5`

选择命令行覆盖的原因：
- 不影响现有 `build:win`（NSIS 安装程序）流程
- `electron-builder.json5` 中默认的 `win.target: ["nsis"]` 保持不变
- portable 构建与 release 构建完全隔离

### `install-channel.ts` 兼容性

portable 版本运行时，`classifyInstall()` 会返回 `"nsis"`（因为 `isPackaged === true` 且平台是 `win32`）。这导致：
- 菜单中出现"检查更新"选项 — 可接受，更新流程会自然失败
- 主要功能（录屏、编辑、导出）完全不受影响

如需区分 portable 版本，后续可在 `extraResources` 中写入 `package-type: portable` 标记文件，但当前手工测试走查阶段不需要。

## 验证方法

构建完成后执行以下手工验证：

1. 确认产物路径：`dist/openscreen-portable-1.10.0/win-unpacked/Openscreen.exe` 可双击
2. 将整个目录复制到桌面，仍可正常启动
3. 验证录屏功能可用
4. 验证视频编辑器可用
5. 验证导出功能可用

## 记录时间

2026-09-07
