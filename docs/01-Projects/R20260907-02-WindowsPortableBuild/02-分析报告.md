# Portable Build 分析报告

## 1. 当前构建架构分析

### 1.1 构建工具链

- **electron-builder v26.15.3** — 构建打包器
- **vite v7.3.6 + vite-plugin-electron** — 渲染进程 + 主进程编译
- **TypeScript** — 类型编译

### 1.2 当前 Windows 构建命令

```
npm run build:win
```

等价于：

```sh
npm run build:native:win      # 编译 WGC 原生捕获助手
npm run fetch:ffmpeg           # 拉取 ffmpeg DLL
npm run fetch:onnxruntime      # 拉取 onnxruntime
npm run stage:vcomp            # 暂存 vcomp runtime
npm run build:native:compositor # 编译 compositor 插件
tsc && vite build              # TypeScript + Vite 前端编译
electron-builder --win --config.npmRebuild=false  # 打包
```

### 1.3 当前产出

- **产物类型**：NSIS 安装程序（`Openscreen.Setup.x.x.x.exe`）
- **产物目录**：`release/${version}/`
- **安装要求**：需要用户执行安装，写入注册表，可能需要 UAC 权限

---

## 2. Portable 目标分析

### 2.1 electron-builder 支持的 Windows 目标

根据 `app-builder-lib/out/options/winOptions.d.ts` 文档，Windows 平台支持以下目标类型：

| 目标名称 | 描述 | 适合 Portable |
|---------|------|--------------|
| `nsis` | NSIS 安装程序（当前） | 否 |
| `portable` | NSIS portable 单文件 .exe（解压到 TEMP 运行） | 接近但非"目录形式" |
| `dir` | 未打包的目录输出 | **是 — 最适合** |
| `zip` | ZIP 压缩包 | 解压后可用，但需要额外步骤 |
| `7z` | 7z 压缩包 | 同上 |

### 2.2 目标方案对比

#### 方案 A：`portable` 目标（NSIS Portable .exe）

- **原理**：生成单个可执行文件，运行时自解压到 `%TEMP%` 临时目录
- **优点**：只有一个 exe 文件
- **缺点**：
  - 每次启动都解压（慢，约数秒）
  - 临时目录中的文件不固定，路径每次可能不同
  - 用户数据（录像）存储在 `userData` 路径，不在 exe 旁边
  - 存在路径映射复杂性

#### 方案 B：`dir` 目标（未打包目录）— **推荐**

- **原理**：electron-builder 打包到一个目录，包含 Electron.exe + 所有资源
- **优点**：
  - 目录可随意移动，双击 `Openscreen.exe` 直接运行
  - 无需安装，无注册表写入
  - 启动速度正常（无解压步骤）
  - 便于手工测试走查
- **缺点**：
  - 目录内文件较多（约 200-500 MB）
  - 需要脚本将目录重命名为 `openscreen-portable-x.x.x`

#### 方案 C：`zip` 目标

- **原理**：将 `dir` 的内容打成 zip 包
- **优点**：单文件便于传输
- **缺点**：需要解压后才能运行，多一步操作

---

## 3. 关键技术约束

### 3.1 原生二进制依赖

`electron-builder.json5` 中 `win.extraResources` 包含：

```json
{
  "from": "electron/native/bin",
  "to": "electron/native/bin",
  "filter": ["win32-*/*", "!win32-*/ffmpeg.exe"]
}
```

这些文件必须存在（从 `build:native:win` + `fetch:ffmpeg` 等步骤生成），否则构建失败。

### 3.2 `beforePack` 脚本

`scripts/before-pack.cjs` 在打包前检查 `compositor_view.node` 的时间戳，如果比 Rust 源码旧则构建失败。这个检查在 `dir` 目标中同样会运行。

### 3.3 `install-channel.ts` 的行为

当通过 `dir` 产物运行时（`app.isPackaged === true`, `process.platform === "win32"`），`classifyInstall()` 会返回 `"nsis"` — 因为代码中的逻辑是：

```typescript
if (probe.platform === "win32") return "nsis";
```

这意味着 portable 版本会：
- 显示"检查更新"菜单项（`ownsItsUpdates("nsis") === true`）
- 尝试自我更新（但因为没有 NSIS 安装，更新会以自然方式失败）

**影响评估**：对手工测试走查无重大影响。更新流程失败是预期行为，主功能（录屏、编辑、导出）不受影响。

### 3.4 `npmRebuild` 设置

当前 `build:win` 传入 `--config.npmRebuild=false`，原因是原生模块已通过单独的构建步骤编译。`dir` 目标沿用此设置。

### 3.5 输出目录配置

当前 `electron-builder.json5` 中：

```json
"directories": {
  "output": "release/${version}"
}
```

portable 版本需要输出到：

```
dist/openscreen-portable-${version}/
```

---

## 4. 方案选择结论

**选择方案 B：`dir` 目标 + 输出目录重命名**

理由：
1. 双击运行即可，无需安装
2. 目录可移动，完全便携
3. 无需解压等额外步骤
4. 适合手工测试走查

---

## 5. 实施要点

### 5.1 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `electron-builder.json5` | 新增 `portable` 配置段（覆盖 `win.target` 和 `directories.output`） |
| `package.json` | 新增 `build:win:portable` script |

### 5.2 方案设计

**新增 `build:win:portable` 脚本**：

```sh
# 复用已有的原生构建步骤，只在 electron-builder 阶段切换目标
npm run build:native:win && \
npm run fetch:ffmpeg && \
npm run fetch:onnxruntime && \
npm run stage:vcomp && \
npm run build:native:compositor && \
tsc && vite build && \
electron-builder --win dir \
  --config.directories.output="dist/openscreen-portable-${version}" \
  --config.npmRebuild=false
```

**关键点**：
- 使用 `--win dir` 指定 `dir` 目标（不需要改 `electron-builder.json5` 中的 `win.target`）
- 通过 `--config.directories.output` 覆盖输出目录（支持 `${version}` 变量）

### 5.3 配置隔离策略

为了不影响现有 `build:win`（NSIS 安装程序）流程，采用**命令行覆盖**方式，不修改 `electron-builder.json5` 中的默认 `win.target`。

---

## 6. 预期产出结构

```
dist/openscreen-portable-1.10.0/
├── Openscreen.exe              ← 直接双击运行
├── resources/
│   ├── app.asar
│   ├── app.asar.unpacked/
│   │   └── **/*.node           ← 原生模块（asarUnpack）
│   ├── electron/native/bin/win32-x64/
│   │   ├── wgc-helper.exe
│   │   ├── compositor_view.node
│   │   ├── av*.dll             ← ffmpeg DLLs
│   │   └── ...
│   ├── wallpapers/
│   ├── cursors/
│   ├── mediapipe/
│   └── ...
├── locales/
├── *.dll                       ← Electron 依赖 DLLs
└── ...
```

---

## 分析时间

2026-09-07
