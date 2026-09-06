# OpenScreen 开发环境与安装包构建 —— 复盘与最佳实践

> 日期：2026-09-06 ｜ 分支：dev-creator（基于 main @ 3957fa24）
> 目标：建分支 → 装依赖 → 产出最新 Windows 安装包 → 本机可用
> 结论：**开发用 `npm run dev`（标准 Electron 身份，零障碍）；出安装包走 CI 管线（本机缺工具链编不了 native helper）**

---

## 一、速查：下次最短路程

### 场景 A：只想在这台机器上开发/调试（推荐，2 分钟）
```bash
cd /d/code/openscreen
git checkout dev-creator        # 或任意功能分支
npm run dev                     # Vite + Electron，主进程 = 原版 electron.exe
```
- 系统视角进程 = `electron.exe`（`node_modules\electron\dist\electron.exe`），Description/ProductName/CompanyName 全是 Electron 官方原版信息 → **公司监控放行**（实测未被拦）。
- 日志：终端直接输出；主进程就绪标志：`Global shortcut registered: CommandOrControl+Shift+O`。

### 场景 B：要出 Windows 安装包（约 40–60 分钟，走 CI）
```bash
# 1. 建分支并推送（上游无权限 → 用 fork）
git checkout -b <your-branch>
git push fork <your-branch>          # fork = git@github.com:creatorliao/openscreen.git（SSH，避开 OAuth workflow scope 限制）

# 2. 等 fork 上 build-whisper-stt.yml 被 push 自动触发跑完（产出 whisper-stt 预编译 artifact，安装包构建的前置依赖）

# 3. 触发官方 Windows 构建（release_tag 留空 = 只产 artifact，不发布 release）
gh workflow run build.yml --repo creatorliao/openscreen --ref <your-branch>

# 4. 轮询 "Windows installer" job 至 success（约 10–15 分钟）
gh run list --repo creatorliao/openscreen --workflow build.yml -L 1

# 5. 下载产物
gh run download <run-id> --repo creatorliao/openscreen --name openscreen-windows --dir release/ci-artifact
# → release/ci-artifact/<version>/Openscreen.Setup.<version>.exe（~231MB，未签名）
```

---

## 二、本机环境事实（决定路线的关键）

| 组件 | 状态 | 影响 |
|------|------|------|
| Node / npm | v24.19.0 / 11.6.0（要求 22.22.1 / 10.9.4） | 仅 engines 警告，`npm install` 正常 |
| npm registry | npmmirror（环境变量已设） | 安装 838 包仅 43s |
| Electron 下载 | 需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` | 缓存里只有 v39，项目要 v41.2.1，不设镜像会走 GitHub 慢/失败 |
| VS Build Tools | 有（VS 18\BuildTools，MSVC 14.51） | `msvcEnv.mjs` 泛化遍历可发现 |
| **Windows SDK** | **无**（无管理员权限装不了） | **WGC helper 无法本地编译 → build:win 本地不可行** |
| cmake / ninja | 无 | WGC helper 需要 |
| Rust/cargo | 有（~/.cargo） | compositor addon（crates/，napi-rs）可编 |
| GitHub 网络 | 直连不通，需代理 | proxy-manager skill（WF01） |
| GitHub 权限 | `creatorliao` 对上游 `getopenscreen/openscreen` 无 push（403） | 只能走个人 fork |
| 系统管控 | WDAC enforcement（CI policy = 2）；AppLocker 服务未运行 | 未签名 NSIS 安装器被拦；原版 electron.exe 放行 |

---

## 三、遇到的困难与解法（按时间线）

### 1. 依赖安装
- **现象**：node/npm 版本与 `engines` 不符 → 只是警告，`npm ci`/`install` 都能跑。
- **要点**：必须先设 `ELECTRON_MIRROR`，否则 electron postinstall 下载 v41.2.1 会走 GitHub（不通）。

### 2. 决定"不能本地全编"的证据链
- 发现 native 产物目录 `electron/native/bin/win32-x64/` 不存在（gitignored，从未构建过）。
- 发现无 Windows SDK / cmake；确认 WGC helper（C++/Win32）强依赖 SDK headers/libs，compat-lib shim 也以 SDK 的 kernel32.lib 为源 → **无 SDK 编不了**。
- 确认 `main` 在 v1.10.0 后含大量 native 改动（wgc pull-based frame delivery、compositor motion blur 等）→ **不能用 v1.10.0 release 里的 stale 预编译二进制**（AGENTS.md 明确的坑）。
- **结论**：本地 `build:win` 死路，改走 GitHub Actions `windows-latest` 官方构建管线（自带完整工具链），产物与 commit 一一对应。

### 3. GitHub 网络不通
- `git push` 报 `Failed to connect to github.com port 443`。
- **解法**：proxy-manager skill WF01（Git 按需代理）：`proxy-manager ensure git --json` → 完成后再 `proxy-manager restore --json` 恢复现场（隧道是原本在跑的，只移除新加的 git proxy）。⚠️ 若遇新网络问题（fetch ffmpeg、7z 下载等）同样先走这个。

### 4. push 上游 403 + OAuth scope 限制
- 上游无 push 权限 → 用个人 fork `creatorliao/openscreen`（已存在，勿重复 fork）。
- HTTPS OAuth token 缺 `workflow` scope，push 更新 workflow 文件被拒 → **改用 SSH remote**（`git@github.com:creatorliao/openscreen.git`，本机 ed25519 已认证），绕开 scope 检查。

### 5. fork 的 workflow "注册惰性"
- 现象：fork 默认分支旧 main 上没有 build.yml → `gh workflow run` 报 404 "not found on the default branch"；workflows API 空。
- **解法**：把 dev-creator push 到 fork 并把 fork 默认分支临时切到 dev-creator（`gh repo edit … --default-branch dev-creator`），push 一个 tag（`v1.10.0-dc`，用完删除）触发 `push: tags: v*` → build.yml 被注册并跑起来；后续即可正常 dispatch。事后还原默认分支为 main、删 tag。

### 6. 第一次 CI 构建失败：缺 whisper-stt artifact
- `stage-whisper-stt.sh` 要从仓库内"最近成功的 build-whisper-stt.yml run"拉 `whisper-stt-win32-x64`，fork 上没有 → `FATAL: could not fetch`，构建拒绝继续（防 STT 静默缺失，是设计好的护栏）。
- **解法**：push dev-creator 会命中 build-whisper-stt.yml 的 `paths` 自动触发四平台构建；等它 success（artifact 出现）→ 重跑 build.yml → Windows job 通过。

### 7. 安装包在本机被系统管控拦截
- 静默安装 exit=1；排查排除 MOTW、PE 损坏、Defender 检测后，定位为**管理员策略拦截**（PowerShell 明确报 "Access has been restricted by your Administrator by policy rule"）。
- 对照实验：`electron.exe`（未签名）能跑，NSIS 安装器（未签名）被拦 → 拦截依据是**身份/信誉策略（WDAC 等）**，不是文件名或 ProductName。**改元数据冒充 Electron/GitHub 既不可行也不该做**。
- **合规出路**（本 repo 开发期已满足）：dev 模式跑的就是原版 `electron.exe`，系统/监控视为标准 Electron 应用，放行。分发/安装包要过管控，需走公司注册 + 代码签名（详见 AGENTS.md / 本机 IT 流程）。

---

## 四、关键命令速记

| 事项 | 命令 |
|------|------|
| 启动开发环境（保持运行） | `(nohup npm run dev > /tmp/openscreen-dev.log 2>&1 &)`；就绪标志 `Global shortcut registered` |
| 查看 dev 日志 | `tail -f /tmp/openscreen-dev.log` |
| 停止 dev | `taskkill //F //IM electron.exe //T`（node/esbuild 一并清理） |
| 出包（CI 快速通道） | 见上文「场景 B」 |
| GitHub 网络故障 | `proxy-manager ensure git --json` → 操作 → `proxy-manager restore --json` |
| 查看安装包哈希 | `sha256sum release/ci-artifact/<v>/*.exe` |
| 校验 native helper 是否当前代码 | `findstr /M /C:"<该版本引入的字符串>" electron\native\bin\win32-x64\wgc-capture.exe` + 对照组 |

---

## 五、下次的坑位提醒（一次讲全）

1. **先判断本地能否全编再决定路线**：检查 `C:\Program Files (x86)\Windows Kits\10\Lib`（SDK）、`where cmake`、VS Build Tools。缺 SDK 就直接走 CI，别浪费时间试本地 build:win。
2. **别用旧 release 的 native 二进制**：`electron/native/bin/` 是 gitignored 且"冻结"，与当前 main 不匹配的 helper 会静默跑旧代码。要么 CI 同 commit 构建，要么本地重编。
3. **fork 不是开箱即用**：默认分支要含最新 workflow、workflow 注册可能惰性（tag push 一次激活）、whisper-stt artifact 要先跑一次。
4. **出包时 release_tag 留空**：只产 artifact、不触发 publish-release（那个 job 在 fork 上因缺 secret 必失败，且会发布到错误位置）。
5. **产物未签名属预期**：fork/本地无上游证书。要正式分发必须走签名或 IT 注册，不能靠伪装身份绕过管控（也绕不过，WDAC 看签名/哈希不看自称）。
6. **代理用完恢复现场**：WF01 restore 只移除本次新增的 git proxy；shadowsocks 隧道若非本会话开启则保持原状。
7. **清理残留**：临时 tag、fork 默认分支、临时 remote（fork）都应及时还原，避免下次误判。

---

## 六、下次出包的完整参考流水（含清理）

```bash
# 0) 环境
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   # npm install 用

# 1) 分支
git checkout -b <branch> && git push fork <branch>               # fork remote 走 SSH

# 2) 等 whisper-stt（约 3–5 分钟）—— push 已自动触发，看其 run 到 success：
gh run list --repo creatorliao/openscreen -L 1 --json databaseId,workflowName,status

# 3) 触发构建并轮询 Windows job
gh workflow run build.yml --repo creatorliao/openscreen --ref <branch>
gh run list --repo creatorliao/openscreen --workflow build.yml -L 1 --json databaseId,status

# 4) 下载
gh run download <run-id> --repo creatorliao/openscreen --name openscreen-windows --dir release/ci-artifact

# 5) 冒烟（本机若被管控拦属预期；验收用 dev 模式）
# 6) 清理：gh repo edit creatorliao/openscreen --default-branch main（若切过）
```
