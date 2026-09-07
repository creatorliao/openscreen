# 最佳实践_Windows本机CMake与原生C++编译

> 用途：在 Windows 上把 **C 或 C++** 源码编成 exe / lib；搞清楚 CMake 和编译器各干什么、开源仓库怎么下手、该装哪套工具链、**智能体能代装什么、不能代装什么**。  
> 从 Recordly 2026-09-06、openscreen 2026-09-07 两轮抽出来：本机没有 CMake、Visual Studio 生成器找不到已登记实例、Ninja 缺失、libclang 缺失，最后用 **vcvars64 + NMake / pip 旁路** 编出 native helper。  
> 以后遇到「自己的 helper」或「随便一个 C/C++ 开源项目要在本机编出来」，按这篇做。

---

## 先回答你这四个问题

| 你问 | 结论（后面展开） |
|------|------------------|
| 编 C++ 或 C，是不是都用这一个 CMake？ | **经常用，但不是唯一。** C 和 C++ 共用同一套「编译器 + 链接器」；CMake 只是其中一种**构建系统**。仓库里有 `CMakeLists.txt` 才优先用 CMake。有 `.sln`、Meson、Autotools 的，跟它走，不要硬套 CMake。 |
| 遇到 C++ 开源项目，想编出来怎么办？ | **先读它的 README / 构建说明**，认出它用哪套构建系统，再装对应工具，按它写的命令配置、编译。不要先装一堆软件再猜。 |
| 应该装哪些工具链？ | Windows 上默认装 **MSVC（Visual Studio 或 Build Tools）+ Windows SDK**。项目用 CMake 再装 **CMake**。其余（Ninja、MinGW、vcpkg、CUDA）**按仓库要求加**，不要一次装全。 |
| 智能体能自动装工具链吗？ | **能代跑安装命令，不能代替你点「允许」和等几 GB 下载。** CMake / Ninja / Git 用 winget 或 zip，智能体可以自动装。完整 MSVC 往往要管理员、很久、可能被公司软件拦。写好「先找、再装、失败回退」的脚本，比每次口头说「帮我装 VS」稳。 |

---

## 〇、先分清两个人：开发机 ≠ 使用机

| 人 | 要不要装 CMake | 要不要装 Visual Studio / 编译器 | 拿到的是什么 |
|----|----------------|----------------------------------|--------------|
| **你（开发 / 打包装机）** | 项目用 CMake 才要（或脚本自动装） | **要**（MSVC 或仓库指定的编译器） | 源码 → 编出 exe → 自己用或打进安装包 / ZIP |
| **最终用户** | **不要** | **不要** | 只解压或安装已经编好的程序 |

CMake 和编译器是 **造房子的工具**。发给别人的是 **已经盖好的房子**。  
不要在使用手册里写「请先安装 CMake」——那是把开发环境摊到用户身上。

编开源项目给自己用，也一样：你这台开发机装工具链；编完的 exe 可以拷走，对方不必再装编译器。

---

## 一、C 和 C++、CMake 和其他东西，各是什么

### 1.1 C 和 C++ 是不是同一套？

**编译器家族是同一套，语言开关不同。**

- 源文件 `.c` → 当 C 编（MSVC 的 `cl.exe`、gcc、clang 都能编 C）。  
- 源文件 `.cpp` / `.cc` / `.cxx` → 当 C++ 编（同一套 `cl.exe`，多了 C++ 标准库）。  
- 链接、出 exe、找 Windows SDK，流程一样。

所以：「我要编一个 C 项目」**不必**另装一套和 C++ 完全不同的工具。差别在仓库声明的语言标准和依赖库。

CMake 里只是：

```cmake
project(foo LANGUAGES C)      # 纯 C
project(foo LANGUAGES CXX)    # 纯 C++
project(foo LANGUAGES C CXX)  # 两种都有
```

### 1.2 CMake 是什么（仍然不是编译器）

**CMake 不是编译器。** 它是「生成构建系统的说明书引擎」：读 `CMakeLists.txt`，再调用本机真正的编译器去出 exe / lib。

```
CMakeLists.txt（有哪些 .c/.cpp、链哪些库）
        ↓  cmake 配置
Makefile / Visual Studio 工程 / Ninja 工程
        ↓  cmake --build  （内部再调 cl / link / nmake / ninja）
xxx.exe
```

没有 CMake，你要自己记一长串 `cl.exe` 参数。换一台电脑命令就碎。  
有了 CMake，换机器时优先保证：**CMake 在**、**编译器在**。

**不能单独完成的事：** 只有 CMake、没有 `cl.exe`（或 gcc/clang），配置或链接仍会失败。

### 1.3 是不是「编 C/C++ 就等于用 CMake」？

**不是。** CMake 是现在开源 C/C++ **最常见**的跨平台构建系统，但仓库用什么，你就用什么。

| 仓库里首先看到 | 构建系统 | 你怎么做 |
|----------------|----------|----------|
| `CMakeLists.txt` | **CMake** | 装 CMake + 编译器；`cmake -S . -B build` → `cmake --build build` |
| `*.sln` / `*.vcxproj` | Visual Studio / MSBuild | 不必强行上 CMake；用 VS 打开，或 `msbuild xxx.sln /p:Configuration=Release` |
| `meson.build` | Meson | 装 Python + meson + ninja |
| `configure` / `autogen.sh` / `Makefile.am` | Autotools | 多为 Linux/macOS；Windows 上看 README，常见是 MSYS2 / 官方给的 CMake 移植 |
| 只有 `Makefile` | Make | 看它是 GNU Make 还是 nmake；Windows 上常要 MinGW 或 WSL |
| `BUILD` / `WORKSPACE`（Bazel） | Bazel | 跟它的文档装 Bazel |
| `xmake.lua` | xmake | 跟它装 xmake |
| `package.json` + `node-gyp` / `binding.gyp` | **Node 原生模块**（`.node`） | 这是另一条：`electron-rebuild` / node-gyp，**不要**用 CMake 硬套（除非它自己包了 CMake） |

**默认策略：**

1. 打开 README 的 Build / Compiling / 构建 一节。  
2. 用上表对号。  
3. 只有「什么都没有、只有一堆 `.c/.cpp`」时，才自己写一份最小 `CMakeLists.txt`。

Electron 旁边的独立小 helper（如 openscreen 的 `wgc-capture`）适合自己用 CMake，因为体积小、只要 Windows API。

### 1.4 CMake 能用来干什么（对你这类场景）

| 场景 | CMake 帮你做什么 |
|------|------------------|
| 编一小段 Windows API / 钩子 / 采集 | `add_executable` + `target_link_libraries(... user32)` |
| 同一套源码换生成器 | VS 工程、NMake、Ninja，换 `-G`，源码不动 |
| Electron 旁边的 native helper | 编完拷进打包目录 |
| 大多数现代开源 C/C++ 库 | 按它的 `CMakeLists.txt` 出静态库 / exe |
| 跨人、跨机复现 | 「有 CMakeLists + 脚本」比「某人本机点过一下 VS」可靠 |

---

## 二、打开一个陌生 C/C++ 开源项目：怎么编

按这个顺序，不要先狂装软件。

### 2.1 五分钟认路

1. **读 README / BUILDING.md / docs/build**（以它写的命令为准）。  
2. **看平台：** 只支持 Linux 的，Windows 上要么 WSL，要么找官方 Windows 说明；不要假设 CMake 一装就能过。  
3. **认构建系统**（上表）。  
4. **列依赖：** OpenSSL、FFmpeg、Qt、CUDA、Python……缺哪个先记下来，再决定装不装。  
5. **看要出什么：** 可执行文件、静态库、还是给你自己的程序链接。

### 2.2 典型 CMake 开源库（Windows + MSVC）

```text
git clone <仓库>
cd <仓库>
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

VS 生成器找不到实例时：先 `call vcvars64.bat`，再：

```text
cmake -S . -B build -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

产物位置：`build/Release/*.exe` 或 `build/*.exe`（NMake）。

有的项目要额外参数，例如 `-DBUILD_SHARED_LIBS=ON`、`-DXXX_ROOT=...`，**以 README 为准**。

### 2.3 编不下来时先查这四类，不要换构建系统

| 现象 | 先怀疑 |
|------|--------|
| `No CMAKE_CXX_COMPILER` / 找不到 `cl` | 没进开发者命令行，或没装 MSVC |
| `could not find any instance of Visual Studio` | 装了 Build Tools 但没登记；走 vcvars + NMake |
| `Could NOT find XXX` | 缺第三方库，按 README 装或给 `-DXXX_ROOT` |
| C4819 / 中文注释语法错误 | MSVC 未加 `/utf-8` |

编开源项目时，优先改 **你的本机环境**；不要一上来改别人的 `CMakeLists.txt`，除非 README 明确要补丁。

### 2.4 编出来之后

- 自己用：记下 exe 路径即可。  
- 要打进 Electron / 自己的产品：拷到「打包会带走的目录」，不要只留在 `build/`。  
- 给同事：给编好的二进制 + 运行所需 dll，**不要**让对方重走编译。

---

## 三、Windows 上应该装哪一套工具链

「工具链」= **编译器 + SDK +（可选）构建系统 +（可选）包管理**。不是只装 CMake。

### 3.1 默认推荐（编 Windows 桌面 / Win32 / 本仓 helper）

按优先级，少而够：

| 优先级 | 装什么 | 干什么 | 没有会怎样 |
|--------|--------|--------|------------|
| 1 | **MSVC + Windows SDK** | 真正编译、链接系统库 | 什么都编不了 |
| 2 | **CMake**（项目用 CMake 时） | 生成工程并驱动编译 | 有 `.sln` 可以暂缓 |
| 3 | **Git** | 拉源码 | 只能手动下 zip |

MSVC 从哪里来（选一个即可）：

- Visual Studio 2022/2026，工作负载勾选 **「使用 C++ 的桌面开发」**  
- **Visual Studio Build Tools**（更轻，没有完整 IDE，只要 C++ 工具集 + Windows SDK）

自检：

```text
where cl
"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cmake --version
```

openscreen 这一轮的事实：磁盘上已有 `cl.exe`（VS 2026 Preview，Build Tools 路径），但 **vswhere 返回空**——Preview 版本不被 CMake 的 Visual Studio 生成器识别。所以「装了编译器」≠「`cmake -G Visual Studio` 一定成功」。退路见 §五.3。

### 3.2 按仓库再加（不要默认全装）

| 工具 | 什么时候才装 |
|------|----------------|
| **Ninja** | README 写 `-G Ninja`，或想比 NMake 更快；openscreen 用 `pip install ninja` 旁路 |
| **libclang** | Rust bindgen 依赖；openscreen 用 `pip install libclang` + 设 `LIBCLANG_PATH` |
| **MinGW-w64 / MSYS2** | 项目明确只要 gcc，或只有 GNU Makefile |
| **LLVM/clang** | 仓库指定 clang-cl |
| **vcpkg / Conan** | README 用它们拉第三方库 |
| **Python + Meson** | 仓库是 Meson |
| **CUDA Toolkit** | 编 GPU / NVENC 一类 |
| **WSL** | 上游只给 Linux 构建说明，且你愿意在 Linux 里编 |

### 3.3 到哪里下载 CMake（开发机）

| 途径 | 地址 / 命令 | 适合 |
|------|-------------|------|
| 官网安装包 | https://cmake.org/download/ | 要开始菜单、要写进系统 PATH |
| GitHub Release | https://github.com/Kitware/CMake/releases | 指定版本、公司网只能下 GitHub 时 |
| winget | `winget install -e --id Kitware.CMake --accept-package-agreements --accept-source-agreements` | Windows 上最少点鼠标 |
| 免安装 zip | 同上 Release 里的 `cmake-*-windows-x86_64.zip`，解压后用 `bin/cmake.exe` | 没管理员权限、或不想装系统级软件 |

装完：`cmake --version`。新终端仍不是命令时，用：

```text
"C:\Program Files\CMake\bin\cmake.exe" --version
```

MSVC / Build Tools：

| 途径 | 说明 |
|------|------|
| 官网 | https://visualstudio.microsoft.com/zh-hans/downloads/ → Build Tools |
| winget | `winget install -e --id Microsoft.VisualStudio.2022.BuildTools`，通常还要加 C++ 工作负载参数（体积大、要管理员） |

Ninja（可选）：`winget install -e --id Ninja-build.Ninja` 或 `pip install ninja`

---

## 四、智能体能不能自动装工具链？

**可以让智能体替你执行安装命令，但它不是系统安装器。** 能不能装成，取决于：你是否允许跑终端、有没有管理员、公司是否拦截安装包、下载是否通。

### 4.1 智能体擅长代装的（openscreen / Recordly 已验证）

| 东西 | 做法 | 现实 |
|------|------|------|
| **CMake** | 脚本：PATH → 常见路径 → winget → 官方 zip 到 `tools/` | winget 装到 `C:\Program Files\CMake\bin\cmake.exe` |
| **Ninja** | `pip install ninja`（PyPI，无需管理员） | openscreen 已验证 |
| **libclang** | `pip install libclang` + 设 `LIBCLANG_PATH` | openscreen Rust bindgen 依赖 |
| **调用已有 MSVC** | 找 `vcvars64.bat`、走 NMake | 编译器已经在磁盘上时，不必重装 |

### 4.2 智能体能试、但常常要你点一下的

| 东西 | 为什么不能「完全静默」 |
|------|------------------------|
| **Visual Studio / Build Tools** | 几 GB、UAC、许可、要勾选 C++ 工作负载；winget 可能装了外壳却没装 `cl.exe` |
| **公司电脑** | 软件管家拦 `.msi` / 未备案安装器 |
| **CUDA 等专用 SDK** | 许可页、路径自定义 |

### 4.3 不要让智能体做的

- 把 CMake/VS 写进最终用户安装说明。  
- 在没有你允许时执行 `winget --force` 卸掉已有 VS。  
- 为了「装全工具链」下载无关的 IDE、Android SDK、整份 CUDA（除非当前仓库 README 点名）。

---

## 五、自己的小项目 / Electron helper：可复用流程

别的仓库要编 Windows C/C++ helper，按这个顺序。

### 5.1 仓库里固定四样东西

1. **源码** + 一份 `CMakeLists.txt`（写清 C 还是 C++、可执行文件名、链接库）。  
2. **一键准备 CMake 的脚本**（先找、再装，失败才报错）。  
3. **一键配置并编译的脚本**（生成器失败要有退路）。  
4. **把 exe 拷到「打包会带走的目录」**，并记指纹（避免下次误用旧二进制）。

CMakeLists 最小形状（C++；纯 C 把 `LANGUAGES` 改成 `C`，源文件改 `.c`）：

```cmake
cmake_minimum_required(VERSION 3.20)
project(your-helper LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
  add_compile_options(/utf-8)  # 源码有中文注释时必加，否则代码页 936 会语法错误
endif()
add_executable(your-helper src/main.cpp)
target_link_libraries(your-helper PRIVATE user32)
```

### 5.2 找 CMake 的顺序（低摩擦优先）

1. `PATH` 上的 `cmake`  
2. `C:\Program Files\CMake\bin\cmake.exe`  
3. 仓库 `tools/cmake-*-windows-x86_64/bin/cmake.exe`（便携、不进 git）  
4. **winget 装 Kitware.CMake**  
5. 下载官方 zip，解压到 `tools/`，`.gitignore` 掉 `tools/cmake-*` 和 zip  

不要第一步就让人去网页点安装向导。脚本能做的，别停下来问。

### 5.3 配置生成器的顺序（openscreen / Recordly 踩过的坑）

1. 先试 CMake 的 Visual Studio 生成器（2026 / 2022 / 2019）。  
2. 若报 `could not find any instance of Visual Studio`：去磁盘找 `vcvars64.bat`（Community / Professional / **BuildTools**）。  
3. `call vcvars64.bat` 之后改用 **`-G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release`**，再 `cmake --build .`。  
4. VS 多配置时 exe 常在 `build/Release/`；NMake 单配置时 exe 常在 `build/` 根上。脚本两种路径都认。

为什么这条退路有价值：公司机经常「装过 Build Tools、没登记、没开过 VS IDE」或装的是 Preview 版本（vswhere 不识别）。坚持 `-G Visual Studio` 会误判成「没有编译器」。

### 5.4 编完立刻「进包」，不要停在 build 目录

编译产物默认在 `**/build/`，打包装时通常会排除 `build/`。  
必须 **copy 到 `electron/native/bin/<平台>/xxx.exe`**（或你项目等价的 extraResources），并更新 helpers 清单（源码指纹 + 二进制哈希）。  
下次源码改了、指纹对不上，就要强制重编，禁止「CMake 没有就沿用仓库里那份旧 exe」当成成功——旧 exe 没有你刚加的逻辑。

### 5.5 最终用户路径

打包配置里把 helper **放进 asar 解包目录或 extraResources**，启动时用绝对路径 spawn，`cwd` 设成 exe 所在目录（避免旁边的 DLL 找不到）。  
用户侧零额外安装。

---

## 六、检查表

开工前（自己的仓库或开源仓库）

- [ ] 已分清：开发机依赖 ≠ 用户依赖  
- [ ] 已认出构建系统（CMake / sln / Meson / 其他），没有硬套  
- [ ] C 或 C++ 已按仓库声明，没有混用错标准  
- [ ] 若是 CMake：有 `CMakeLists.txt`；MSVC 开了 `/utf-8`（源码可能含中文时）  
- [ ] `.gitignore` 忽略 `**/build/` 和本机 `tools/cmake-*`

工具链

- [ ] `cl.exe` 或 `vcvars64.bat` 找得到（默认 MSVC）  
- [ ] 需要 CMake 时：`cmake --version` 或 ensure 脚本已成功  
- [ ] 需要 Ninja 时：`ninja --version`（或 `pip install ninja`）  
- [ ] 需要 libclang 时：`pip install libclang`，`LIBCLANG_PATH` 已设  
- [ ] 额外依赖只按 README 装，没有一次装全  

智能体 / 自动化

- [ ] CMake 用 ensure 脚本（winget / zip），不要每次手点官网  
- [ ] MSVC 只探测；没有就给一条安装命令，等人点允许  
- [ ] 生成器失败会走 NMake，而不是静默用旧 exe（除非明确回退暂存）  

编完

- [ ] 新产物已拷到打包目录或你要用的位置  
- [ ] 指纹 / 清单已更新（若有）  
- [ ] 发给别人的是二进制，手册里没有「请安装 CMake / Visual Studio」

---

## 七、常见误判

| 误判 | 实际 |
|------|------|
| 「编 C++ 就必须用 CMake」 | 先看仓库；有 sln 就用 MSBuild |
| 「编 C 要另装一套和 C++ 不同的工具」 | 同一套 MSVC/gcc，语言开关不同 |
| 「装了 CMake 就能编 C/C++」 | 还要编译器 |
| 「智能体会自己装好整个 Visual Studio」 | 它能跑 winget；大 IDE/Build Tools 要你允许，还可能被拦 |
| 「文件夹里有 VS BuildTools 就算 CMake 能用 VS 生成器」 | 必须安装器登记，Preview 版本 vswhere 不识别；否则走 vcvars + NMake |
| 「仓库里已有 exe，构建退出码 0 就是新逻辑已生效」 | 可能是跳过编译、复用旧文件 |
| 「用户也要装 CMake」 | 只有要从源码编的人才要 |
| 「CMake 能替代 node-gyp / electron-rebuild」 | 那是编 Node 的 `.node`。独立 exe 用 CMake 更干净 |

---

## 八、和本仓文档的关系

- **构建环境安装步骤**：`docs/02-Areas/win-build-env-setup.md`  
- **Portable 改造做法**：`docs/02-Areas/20260906-03-最佳实践_Electron应用改造成Portable.md`  
- **构建脚本**：`scripts/build-windows-portable.mjs`、`scripts/msvcEnv.mjs`  
- **Native helper 二进制**：`electron/native/bin/win32-x64/`（gitignored，由 `npm run build:native:win` 生成）  

换项目时带 **先回答 + 〇～五 + 六** 走；openscreen / Recordly 路径当例题，不要把产品名写进下一份脚本里当硬编码。
