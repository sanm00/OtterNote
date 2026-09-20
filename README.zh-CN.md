# OtterNote

[![CI](https://github.com/sanm00/OtterNote/actions/workflows/ci.yml/badge.svg)](https://github.com/sanm00/OtterNote/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/otter-note.svg)](https://www.npmjs.com/package/otter-note)
[![Downloads](https://img.shields.io/npm/dm/otter-note.svg)](https://www.npmjs.com/package/otter-note)
[![Release](https://img.shields.io/github/v/release/sanm00/OtterNote.svg)](https://github.com/sanm00/OtterNote/releases)
[![License: MIT](https://img.shields.io/github/license/sanm00/OtterNote.svg)](LICENSE)

[English](README.md) | **简体中文**

本地优先的笔记与待办应用，采用双栏工作区。笔记、附件和搜索索引都保存在你自己的电脑上。

> 状态：尚未发布 1.0，仍在积极开发中。数据格式与快捷键在版本之间仍可能变化。
>
> 本翻译以 [README.md](README.md) 为准，如有出入请以英文版为准。

## 功能

- 双栏工作区：侧边导航 + 内容区
- 笔记列表、笔记详情、时间线、待办列表、图片、设置与帮助
- Markdown 编辑与预览
- 从笔记正文中内联解析待办
- 时间线视图按时间分组
- 通过文件选择器或粘贴上传图片
- 桌面端分别存储预览图与原图
- 笔记导出为 Markdown
- 全局搜索笔记与待办内容
- 浅色与深色主题
- 可自定义的键盘快捷键
- 笔记置顶小窗

## 安装

预编译安装包发布在 [Releases 页面](https://github.com/sanm00/OtterNote/releases)。

> 目前还没有发布任何 release，因此下面的命令暂时还无法使用。
> 首个 release 之前，请[从源码构建](#从源码构建)。

### 一条命令

macOS 与 Linux，安装最新版本：

```sh
curl -fsSL https://raw.githubusercontent.com/sanm00/OtterNote/main/release/install/install.sh | sh
```

或使用 npm：

```sh
npm install -g otter-note
```

两者运行的是同一个安装脚本：识别操作系统与 CPU 架构、下载对应的 release 资产、在校验文件存在时进行校验，并把应用安装到 `/Applications`（macOS）或 `~/.local/bin`（Linux）。两者都不会调用 `sudo`，也不会改动你的笔记。请从启动器打开 OtterNote，或运行 `otter-note`。

首次启动会被系统拦截，因为构建产物还没有签名和公证。右键点击应用并选择**打开**，或在**系统设置 → 隐私与安全性**中允许运行。

### 选项

参数传给脚本；使用 npm 时传给 `otter-note install`：

```sh
sh install.sh --version 0.1.0                      # 安装指定版本
sh install.sh --install-dir "$HOME/Applications"   # 指定安装目录
sh install.sh --dry-run                            # 只展示计划，不做任何改动
sh install.sh --uninstall                          # 移除应用
sh install.sh --yes                                # 不再交互确认
```

用一条命令的形式时，参数写在 `sh -s --` 之后：

```sh
curl -fsSL https://raw.githubusercontent.com/sanm00/OtterNote/main/release/install/install.sh |
  VERSION=0.1.0 sh -s -- --dry-run
```

`VERSION`、`INSTALL_DIR`、`DRY_RUN`、`YES` 和 `BASE_URL` 也可以作为环境变量传入，npm CLI 另有对应的 `OTTERNOTE_*` 变量。
`BASE_URL` 用于把安装脚本指向镜像站或自建产物。

想先读一遍脚本再运行：

```sh
curl -fsSLO https://raw.githubusercontent.com/sanm00/OtterNote/main/release/install/install.sh
less install.sh && sh install.sh
```

### 手动下载

| 平台                | 安装包                                          |
| ------------------- | ----------------------------------------------- |
| macOS（Apple 芯片） | `OtterNote_<version>_aarch64.dmg`               |
| macOS（Intel）      | `OtterNote_<version>_x64.dmg`                   |
| Linux（x86_64）     | `otter-note_<version>_amd64.AppImage` 或 `.deb` |

macOS：打开 `.dmg`，把 **OtterNote** 拖进「应用程序」。

Linux：`chmod +x otter-note_<version>_amd64.AppImage` 后运行，或用
`sudo dpkg -i otter-note_<version>_amd64.deb`。AppImage 需要 `libfuse2`；
没有该库时，用 `--appimage-extract-and-run` 运行。

OtterNote 支持 macOS 与 Linux，暂不支持 Windows。

### 卸载

```sh
otter-note uninstall          # 移除桌面应用（npm 安装方式）
npm uninstall -g otter-note   # 移除 CLI 本身
```

不使用 npm 时：

- **macOS**：删除 `OtterNote.app`，或运行 `sh install.sh --uninstall`。
- **Linux**：删除 AppImage，或运行 `sudo dpkg -r otter-note`，也可运行
  `sh install.sh --uninstall`。

卸载不会删除你的笔记，笔记保留在 `~/OtterNote`（见[存储](#存储)）。

### 校验下载

安装 OtterNote 并不需要这一步。如果你想确认下载到的文件与 release 发布的内容一致，release 中同时提供 `SHA256SUMS`：

```sh
shasum -a 256 -c SHA256SUMS   # macOS
sha256sum -c SHA256SUMS       # Linux
```

这能发现损坏或被替换的下载。它不是签名，也不能替代代码签名——当前构建还没有签名。

## 技术栈

Tauri 2、React 18、TypeScript、Vite、Tailwind CSS、Zustand、CodeMirror 6，桌面端的文件系统访问由 Rust 实现。

## 环境要求

| 工具           | 版本                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| Node.js        | 24（见 `.nvmrc`）                                                      |
| Rust           | 1.96.0（见 `rust-toolchain.toml`）                                     |
| Tauri 系统依赖 | 见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)（英文） |

## 从源码构建

面向贡献者，以及没有预编译包的平台。

安装依赖：

```sh
npm install
```

运行 Web 预览：

```sh
npm run dev
```

运行桌面应用：

```sh
npm run tauri -- dev
```

## 存储

应用完全本地优先，无需联网即可使用。

- 开发环境的桌面构建把数据放在你所用检出目录的 `data` 文件夹里，与从哪个目录启动无关。该目录已被 Git 忽略；开发构建也拒绝退回到 `~/OtterNote`。若要把开发数据彻底放到别处，设置 `OTTERNOTE_DATA_DIR`（见 `CONTRIBUTING.md`）。
- 正式（release）桌面构建使用 `~/OtterNote`。
- Web 预览使用浏览器的 `localStorage`。
- 桌面端可以在「设置」中更改存储目录。
- 存储目录本身可以是符号链接，但目录内的文件不行：出现在笔记或附件位置上的链接会被拒绝而不是跟随，因此从别处导入的目录无法让应用读取或覆盖目录之外的文件。

数据布局：

| 路径                | 内容             |
| ------------------- | ---------------- |
| `state.json`        | 应用状态根节点   |
| `notes/*.json`      | 笔记数据包       |
| `images/*`          | 原图与预览图附件 |
| `search-index.json` | 可重建的搜索索引 |

图片与笔记正文分开存放，因此笔记可以保持很小、打开很快。

## 开发

```sh
npm run dev                # Web 预览
npm run tauri -- dev       # 桌面应用
npm run typecheck          # TypeScript
npm run lint               # ESLint
npm run format:check       # Prettier 检查
npm test                   # Vitest
npm run build              # 前端构建
```

Rust 检查：

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 生产构建

```sh
npm run tauri -- build
```

该命令先构建前端，再为当前平台打包桌面应用，并使用该平台支持的全部打包格式（`bundle.targets` 为 `all`）。产物位于 `src-tauri/target/release/bundle/`：

| 路径                                            | 内容           |
| ----------------------------------------------- | -------------- |
| `macos/OtterNote.app`                           | macOS 应用包   |
| `dmg/OtterNote_<version>_<arch>.dmg`            | macOS 磁盘镜像 |
| `appimage/otter-note_<version>_<arch>.AppImage` | Linux 便携应用 |
| `deb/otter-note_<version>_<arch>.deb`           | Debian 软件包  |

在 macOS 上打包 `.dmg` 会驱动 Finder 排布磁盘镜像窗口。如果你的环境不允许，可以在**系统设置 → 隐私与安全性 → 自动化**中给终端授权，或者跳过这一步骤：

```sh
CI=true npm run tauri -- build
```

打包产物可以直接安装：`.app` 拖进「应用程序」，`.dmg` 与各平台安装器双击打开。本地构建的产物没有签名，因此[安装](#安装)一节中描述的首次启动提示同样适用。

debug 构建更快，但它不是生产产物：它把数据放在检出目录的 `data` 文件夹里（见[存储](#存储)），请不要把它当作日常应用安装：

```sh
npm run tauri -- build --debug
```

## 隐私

OtterNote 不会把笔记内容、附件或使用数据发送到任何地方。笔记只保存在上面提到的存储目录中。安全问题的披露流程见 [SECURITY.md](SECURITY.md)（英文）。

## 已知限制

- 仅限单机：没有账号体系、云同步和多人协作。
- 仅支持 macOS 与 Linux；不支持 Windows。
- 暂无自动更新；通过安装新版本来升级。
- 构建产物尚未签名和公证，因此首次启动需要[安装](#安装)一节中的手动步骤。
- 存储格式仍在演进；迁移会自动尝试，但重要数据请自行备份。

## 文档

- [开源路线图](docs/open-source-roadmap.md)：安全加固、测试、模块化与发布计划。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。请勿公开提 issue 报告安全问题，走 [SECURITY.md](SECURITY.md)（英文）中的流程。

## 许可证

[MIT](LICENSE)
