# OpenScreen Windows 构建环境安装最佳实践报告

> 本文档由 2026-09-08 实际踩坑经历整理而来，目标：**下次从零搭建只需 30 分钟，不再靠试错**。

---

## 一、根本原因分析：为什么这次花了那么长时间

### 1.1 问题清单与耗时估算

| # | 问题 | 表现 | 耗时估算 |
|---|------|------|---------|
| 1 | **代理未提前启动** | onnxruntime（74 MB）、ffmpeg（206 MB）、Rust crates 下载超时反复重试 | ~40 分钟 |
| 2 | **VS BuildTools 未安装 CMake/Ninja 组件** | CMake 报 `CMAKE_MAKE_PROGRAM not set`，WGC helper 无法编译 | ~15 分钟（排查+绕行） |
| 3 | **LLVM/Clang 未安装** | Rust bindgen 报 `Unable to find libclang`，compositor 编译失败 | ~20 分钟（排查+绕行） |
| 4 | **Node 版本不匹配** | 当前 Node v24，项目要求 v22.22.1 | 幸运地未引发运行时错误，但潜在风险 |
| 5 | **缺少 `electron/native/bin/` 目录** | `beforePack.cjs` 检查失败，没有此目录构建直接终止 | 级联导致上述所有问题 |

### 1.2 根本原因归纳

**核心根因只有一个：环境准备清单（checklist）缺失。**

`package.json` 中的 `build:win:portable` 命令链假设以下工具已经就绪：

```
MSVC (vcvarsall.bat) + Ninja + CMake → 编译 WGC C++ helper
Rust (cargo) + LLVM (libclang) → 编译 compositor Rust addon  
Node.js + npm → 前端编译
网络（代理） → 下载 ffmpeg / onnxruntime / Rust crates
```

但这些前置条件**没有文档记录**，也没有预检脚本，导致每次遇到一个问题就要花时间定位、试错、绕行。

### 1.3 次要原因：绕行方案比正道慢

| 正确做法 | 实际绕行做法 | 额外耗时 |
|---------|------------|---------|
| VS Installer 安装 CMake 组件 | `pip install ninja` 绕行 | +5 min |
| 安装 LLVM 官方包 | `pip install libclang` 绕行 | +10 min |
| 提前配置 `HTTPS_PROXY` | 每条命令手动加 env 前缀 | +5 min |

绕行方案本身可行，但发现问题→想出绕行→执行的过程消耗了大量时间。

---

## 二、操作步骤回顾（时间线）

```
Step 01  发现 dist/ 为空 → 意识到构建从未执行过
Step 02  尝试 npm run build:win:portable 全链路
Step 03  ✗ build:native:win 失败 → CMake 找不到 Ninja
Step 04  查找 Ninja：vswhere 失败、find 无结果、winget 下载超时
Step 05  ✓ pip install ninja → ninja 1.13.2 安装到 Python Scripts/
Step 06  ✓ build:native:win 成功（WGC C++ helper 编译完成）
Step 07  ✓ fetch:ffmpeg → 下载 206 MB（无代理，速度慢但成功）
Step 08  ✗ fetch:onnxruntime → 74 MB 下载超时（无代理）
Step 09  发现 proxy-manager 工具
Step 10  ✓ proxy-manager start → Shadowsocks + Proxifier 启动，端口 1087
Step 11  ✓ HTTPS_PROXY=http://localhost:1087 fetch:onnxruntime 成功
Step 12  ✓ stage:vcomp → 复制 MSVC 运行时 DLL
Step 13  ✗ build:native:compositor（Rust）→ bindgen 报 libclang 缺失
Step 14  查找 LLVM：系统未安装，winget 需要管理员权限失败
Step 15  ✓ pip install libclang → libclang 18.1.1 安装
Step 16  ✓ LIBCLANG_PATH 指向 pip 安装路径，compositor 编译成功（~75s）
Step 17  ✓ tsc && vite build 成功（~29s）
Step 18  ▶ electron-builder --win dir 打包（进行中）
```

---

## 三、环境安装最佳实践

### 3.1 前置检查（每次新机器必做）

在运行任何构建命令之前，执行以下检查命令，全部绿灯再继续：

```powershell
# 1. Node.js 版本（必须 22.x）
node --version           # 期望: v22.22.1

# 2. npm 版本
npm --version            # 期望: 10.9.4

# 3. Rust/Cargo
cargo --version          # 期望: cargo 1.x

# 4. Ninja（CMake 构建后端）
ninja --version          # 期望: 1.x

# 5. CMake
cmake --version          # 期望: 3.x 或 4.x

# 6. libclang（Rust bindgen 依赖）
python -c "import clang; print(clang.__version__)"  # 期望: 18.x

# 7. MSVC（vcvarsall.bat 路径）
node -e "
const {findVcVarsAll}=require('./node_modules/electron-builder/out/index.js');
" # 或手动确认 VS BuildTools 已安装

# 8. 代理（访问 GitHub/crates.io）
proxy-manager status     # 期望: Shadowsocks: 运行中
```

### 3.2 标准安装步骤（全新 Windows 机器）

按此顺序执行，约 30 分钟完成全部依赖安装。

#### Step 1：安装 Node.js（版本精确匹配）

```powershell
# 推荐用 fnm（快速 Node 版本管理器）
winget install Schniz.fnm
fnm install 22.22.1
fnm use 22.22.1
fnm default 22.22.1

# 验证
node --version   # v22.22.1
npm --version    # 10.9.4
```

> **为什么必须精确匹配？** `package.json` 的 `engines` 字段锁定了版本，`@electron/rebuild` 通过 `package-lock.json` 重建原生模块，版本不匹配会导致 ABI 不兼容。

#### Step 2：安装 Rust 工具链

```powershell
# 官方安装脚本（https://rustup.rs）
# 离线/代理环境：先启动代理再执行
winget install Rustlang.Rustup
rustup default stable
rustup target add x86_64-pc-windows-msvc

# 验证
cargo --version
```

#### Step 3：安装 Visual Studio Build Tools（含所有必要组件）

**关键：一次性安装所有组件，避免后续反复修复。**

```powershell
# 下载 Build Tools 离线安装器后执行：
vs_BuildTools.exe --passive --wait --add Microsoft.VisualStudio.Workload.VCTools ^
  --add Microsoft.VisualStudio.Component.VC.CMake.Project ^
  --add Microsoft.VisualStudio.Component.VC.Llvm.Clang ^
  --add Microsoft.VisualStudio.Component.VC.Llvm.ClangToolset
```

必须包含的组件：

| 组件 ID | 作用 |
|---------|------|
| `Workload.VCTools` | MSVC 编译器（cl.exe）、链接器 |
| `Component.VC.CMake.Project` | CMake + **Ninja**（wgc-capture 编译依赖）|
| `Component.VC.Llvm.Clang` | **libclang.dll**（Rust bindgen 依赖）|
| `Component.VC.Llvm.ClangToolset` | clang-cl 工具集 |

> **如果用 pip 绕行（无管理员权限时）：**
> ```powershell
> pip install ninja libclang
> # 然后设置环境变量（加入系统 PATH / 用户环境变量）：
> # LIBCLANG_PATH = %APPDATA%\..\Local\Programs\Python\Python3xx\Lib\site-packages\clang\native
> ```

#### Step 4：安装 CMake（系统级，独立于 VS）

```powershell
winget install Kitware.CMake
# 验证
cmake --version
```

#### Step 5：配置代理（网络访问 GitHub、crates.io、npm）

```powershell
# 启动代理链路（Shadowsocks + Proxifier）
proxy-manager start

# 验证代理端口
Test-NetConnection -ComputerName localhost -Port 1087

# 为当前 shell 会话设置代理环境变量（构建期间保持）
$env:HTTPS_PROXY = "http://localhost:1087"
$env:HTTP_PROXY  = "http://localhost:1087"

# npm 代理（如果 npm 下载慢）
npm config set proxy http://localhost:1087
npm config set https-proxy http://localhost:1087

# Cargo 代理（写入 %USERPROFILE%\.cargo\config.toml）
# [http]
# proxy = "http://localhost:1087"
```

> **关键提醒**：代理必须在 `fetch:ffmpeg`、`fetch:onnxruntime`、`build:native:compositor`（下载 Rust crates）之前启动，否则下载失败或超时。

#### Step 6：安装项目依赖

```powershell
cd D:\code\openscreen

# 代理已启动的情况下
npm ci
```

#### Step 7：验证完整工具链

```powershell
# 运行此脚本，全部 PASS 再进行构建
node -e "
const checks = [
  ['node', () => process.version.startsWith('v22')],
  ['ninja', () => { require('child_process').execSync('ninja --version'); return true; }],
  ['cargo', () => { require('child_process').execSync('cargo --version'); return true; }],
  ['libclang', () => {
    const fs = require('fs');
    const p = require('path');
    const site = require('child_process').execSync('python -c \"import site; print(site.getsitepackages()[0])\"', {encoding:'utf8'}).trim();
    return fs.existsSync(p.join(site, 'clang', 'native', 'libclang.dll'));
  }],
  ['vcvarsall', () => {
    const fs = require('fs');
    return fs.existsSync('C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Auxiliary/Build/vcvarsall.bat')
        || fs.existsSync('C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvarsall.bat');
  }],
  ['proxy-port', () => {
    try {
      require('child_process').execSync('powershell -Command \"Test-NetConnection localhost -Port 1087 -InformationLevel Quiet\"', {encoding:'utf8'});
      return true;
    } catch { return false; }
  }],
];
checks.forEach(([name, fn]) => {
  try { console.log(fn() ? '[PASS]' : '[FAIL]', name); }
  catch(e) { console.log('[FAIL]', name, '-', e.message.split('\n')[0]); }
});
"
```

---

### 3.3 构建命令速查

```powershell
# 在启动代理后，设置环境变量，然后一键构建 portable 版本：
$env:HTTPS_PROXY    = "http://localhost:1087"
$env:HTTP_PROXY     = "http://localhost:1087"
$env:LIBCLANG_PATH  = "$env:LOCALAPPDATA\Programs\Python\Python313\Lib\site-packages\clang\native"

npm run build:win:portable

# 产出位置：
# dist\openscreen-portable-<version>\Openscreen.exe
```

单独重跑各阶段（当部分步骤已完成时，可跳过）：

```powershell
# 仅重编译原生模块（C++）
node scripts/build-windows-wgc-helper.mjs

# 仅重编译 compositor（Rust，最耗时 ~75s）
$env:LIBCLANG_PATH = "..."
node scripts/build-windows-compositor-addon.mjs

# 仅下载 ffmpeg（~200 MB，需要代理）
$env:HTTPS_PROXY = "http://localhost:1087"
node scripts/fetch-ffmpeg.mjs

# 仅下载 onnxruntime（~74 MB，需要代理）
$env:HTTPS_PROXY = "http://localhost:1087"
node scripts/fetch-onnxruntime.mjs

# 仅前端编译
npx tsc && npx vite build

# 仅打包（所有原生文件已就绪时）
node scripts/build-windows-portable.mjs
```

---

### 3.4 常见错误速查表

| 错误信息 | 根本原因 | 解决方案 |
|---------|---------|---------|
| `CMAKE_MAKE_PROGRAM is not set` | Ninja 未安装 | `pip install ninja` 或 VS 安装 CMake 组件 |
| `Unable to find libclang` | LLVM/Clang 未安装 | `pip install libclang` + 设置 `LIBCLANG_PATH` |
| `electron/native/bin/win32-x64 does not exist` | 原生编译步骤未执行 | 先跑 `build:native:win` + `fetch:ffmpeg` + `fetch:onnxruntime` + `stage:vcomp` + `build:native:compositor` |
| 下载超时（ffmpeg / onnxruntime / crates） | 代理未启动 | `proxy-manager start`，设置 `HTTPS_PROXY` |
| `vswhere.exe` 返回空 | VS 2026 是 Preview，vswhere 旧版不识别 | 代码已有通用路径遍历兜底（`msvcEnv.mjs`），一般无需干预 |
| `ABI 不兼容` 或原生模块加载失败 | Node 版本与构建时不一致 | 确保 Node 版本 = `22.22.1` |
| `EPERM: operation not permitted` | 写入系统目录无权限 | 改写到用户目录（如 `D:/tools/`），或用管理员终端 |

---

### 3.5 环境变量持久化建议

将以下内容加入**用户级系统环境变量**（控制面板 → 系统 → 高级系统设置 → 环境变量），避免每次手动设置：

```
LIBCLANG_PATH  = C:\Users\<你的用户名>\AppData\Local\Programs\Python\Python313\Lib\site-packages\clang\native
```

Cargo 代理写入 `%USERPROFILE%\.cargo\config.toml`：

```toml
[http]
proxy = "http://localhost:1087"

[net]
retry = 3
```

npm 代理（如果长期使用代理）：

```powershell
npm config set proxy http://localhost:1087
npm config set https-proxy http://localhost:1087
```

> **注意**：npm 代理在代理不运行时会导致 `npm install` 失败。建议只在构建时临时设置（shell 变量），不写入全局 npm config。

---

## 四、最终工具版本矩阵（本次实际验证通过）

| 工具 | 版本 | 安装来源 |
|------|------|---------|
| Node.js | v24.19.0 *(推荐 v22.22.1)* | 系统预装 |
| npm | 11.6.0 | 随 Node |
| Rust / Cargo | 1.93.0 | rustup |
| Visual Studio BuildTools | 18.9.1 (VS 2026 Preview) | VS Installer |
| MSVC 工具集 | 14.51.36231 | VS BuildTools |
| CMake | 4.4.3 | winget |
| Ninja | 1.13.2 | `pip install ninja` |
| libclang | 18.1.1 | `pip install libclang` |
| Python | 3.13.13 | 系统预装 |
| proxy-manager | 0.1.9 | pip |

---

## 五、下次新机器安装清单（30 分钟目标）

```
□ 1. [ 5 min] fnm install 22.22.1 && fnm default 22.22.1
□ 2. [10 min] VS BuildTools + CMake + Clang 组件（一次性安装）
□ 3. [ 3 min] winget install Rustlang.Rustup && rustup default stable
□ 4. [ 2 min] winget install Kitware.CMake
□ 5. [ 2 min] pip install ninja libclang
□ 6. [ 1 min] 设置 LIBCLANG_PATH 用户环境变量
□ 7. [ 1 min] 写入 .cargo/config.toml（代理 + retry）
□ 8. [ 1 min] proxy-manager start（验证端口 1087 监听）
□ 9. [ 3 min] cd openscreen && npm ci
□ 10.[ 2 min] 运行验证脚本，全部 PASS
□ 11.[构建]  $env:HTTPS_PROXY=... && npm run build:win:portable
```

---

*文档版本：v1.0 | 记录日期：2026-09-08 | 适用项目：openscreen v1.10.0+*
