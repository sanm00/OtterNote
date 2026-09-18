# OtterNote 开源改造计划

本文档用于指导 OtterNote 从当前可用的个人项目，逐步改造成适合公开维护、社区贡献和跨平台发布的开源桌面应用。

## 目标

- 让陌生开发者可以在干净环境中完成安装、开发和构建。
- 让用户清楚了解数据存储位置、格式、备份和恢复方式。
- 限制 Tauri 文件系统权限，避免路径穿越和任意文件访问。
- 建立自动化测试、代码检查和跨平台构建流程。
- 降低社区贡献者理解和修改代码的成本。
- 通过 GitHub Releases 提供可直接安装的应用包。

## 当前基线

- 技术栈：Tauri 2、React 18、TypeScript、Vite、Tailwind CSS、Zustand、CodeMirror 6 和 Rust。
- 前端主要逻辑集中在 `src/main.tsx`；首批改造已把若干纯函数抽到 `src/lib/`，该文件本身仍需继续拆分。
- Rust command、存储、搜索和附件逻辑主要集中在 `src-tauri/src/lib.rs`。
- 首批改造前只有 `src/todo-parser.test.ts` 一组前端测试；现在前端共 6 个测试文件、91 个用例，Rust 有 19 个用例。
- 首批改造前没有 LICENSE、CI、代码格式化配置、Lint 配置或贡献指南，这些已在本轮补齐。
- 开发环境数据默认保存在仓库根目录的 `data/`（已加入 `.gitignore`），与进程启动时的工作目录无关（早期实现用 `std::env::current_dir()`，debug 构建被 Finder 启动时工作目录是 `/`，数据目录会变成 `/data`；现已改为按编译期 crate 目录定位，并补了单元测试）；生产环境数据默认保存在 `~/OtterNote`，包括 `state.json`、`notes/`、`images/` 和 `search-index.json`。
- `src-tauri/tauri.conf.json` 已配置最小可用 CSP（`csp` 与 `devCsp`），首批改造前为空。

## 执行原则

1. 保持现有用户功能和数据格式兼容，优先做小步、可回滚的改造。
2. 重构提交不混入功能变更，便于审查和定位回归。
3. 先建立测试和质量门禁，再进行大规模模块拆分。
4. 不在当前阶段引入账号、云同步、后端服务或复杂插件系统。
5. 任何存储格式变化都必须伴随版本迁移和恢复测试。

## 阶段计划

> 进度更新（2026-09-17）：阶段一的大部分、阶段二的核心项、阶段三和阶段六的 CI 已完成。
> 勾选项均已本地验证：`npm ci`、`npm run typecheck`、`npm run lint`（0 error / 13 warning）、
> `npm run format:check`、`npm test`（102 例，含 npm CLI 的 11 例）、`cargo fmt --check`、
> `cargo clippy --all-targets -- -D warnings`、`cargo test`（32 例）和 `npm run build` 全部通过，
> 并在生产 CSP 下验证前端可正常运行。未勾选项及需要产品决策的部分见各项标注。

### 阶段一：开源基线

优先级：P0。目标是让项目具备公开仓库的基本法律、文档和环境基础。

任务：

- [x] 选择并添加开源许可证，建议 MIT 或 Apache-2.0。（采用 MIT）
- [x] 在 README 增加许可证、项目状态、支持平台和隐私说明。
- [x] 增加 `CONTRIBUTING.md`、`SECURITY.md` 和 `CODE_OF_CONDUCT.md`。（`CODE_OF_CONDUCT.md` 采用自写简短版：尊重待人 + 举报走公开 Issues、私有 security advisory 或 GitHub abuse 通道，不含占位符）
- [x] 增加 `.editorconfig`、`.nvmrc` 或 `.node-version`、`rust-toolchain.toml`。
- [x] 清理仓库中的敏感信息、内部地址和不应公开的资源。（已扫描源码与文档，未发现密钥或内网地址；开发数据目录 `data/` 已加入 `.gitignore`）
- [x] 移除或重新评估 `package.json` 中的 `private` 字段。（根 `package.json` 保持 `private: true`：它不是待发布的包，`npm pack` 会打包约 9.0 MB、61 个文件的源码与测试。面向用户的 CLI 独立为 `packages/npm-cli`（包名 `otter-note`，含 `files` 白名单），发布形态已确定）
- [x] 压缩 `public/` 和 `src-tauri/icons/` 中的大尺寸图片。（删除无任何引用的 `app-logo.png`、`app-logo-dark.png`、`favicon.svg`，以及构建不使用的 `icon.iconset/`；`app-logo-transparent.png` 1254²→256²、`favicon.png` 1254²→128²。`dist` 4.46 MB→1.06 MB，release 二进制 73.1 MB→70.7 MB，dmg 9.48 MB→7.18 MB（−24%）。`src-tauri/icons/icon.png` 保留：被 `tauri.conf.json` 引用（Linux 图标），且是唯一的高分辨率母版，是否降到 1024² 待定）

验收标准：

- 新开发者只按 README 操作即可启动前端和 Tauri 开发环境。
- 仓库有明确的许可证和漏洞反馈渠道。
- Node、Rust 和系统依赖版本有明确说明。
- 仓库不包含密钥、个人隐私或内部配置。

### 阶段二：安全与数据可靠性

优先级：P0。目标是确保本地笔记和附件不会因恶意输入或异常退出而损坏或越权访问。

任务：

- [x] 为 `src-tauri/tauri.conf.json` 配置最小可用 CSP，验证 Markdown、图片和开发环境均可正常工作。（已配置 `csp` 与 `devCsp`；用生产 CSP 加载构建产物验证：Tailwind 样式与 CodeMirror 生效，`blob:`、`data:` 和同源图片可加载，注入的内联脚本与跨域脚本被拦截，控制台无 CSP 违规）
- [x] 审查 `src-tauri/capabilities/default.json`，将默认权限收紧到实际需要的 command。（改为 `core:event:default` 加 `dialog:allow-open|save|ask`；同时修复删除确认所需的 `dialog:allow-ask` 原本缺失的问题）
- [x] 审计所有涉及路径的 command：存储目录、笔记、附件、导出和 pinned window。（逐一复核后新增中央守卫 `ensure_inside_storage_root`：从存储根开始逐段 `symlink_metadata`，既拒绝落在根外的路径（含 `Path::join` 遇绝对段整体替换的老问题），也拒绝根内被植入的符号链接。接线在 `resolve_transaction_path`、事务写入的每个 target 与删除项、`write_note_bundles`、`read_note_bundle`、`read_image_attachment_bytes`、`store_optimized_attachment` 的每次 `fs::write`、隔离区恢复的 `rename`；`list/delete_image_attachment` 原本就按 `file_type().is_file()` 过滤，符号链接条目本就被跳过。导出 `write_export_file` 的目标由系统保存对话框给出，落在根外属设计预期，故不加限制；pinned window 只使用 `sanitize_window_label` 的结果作为标签。审计过程中发现并修复一处真实逃逸：`write_note_bundles`（旧数据迁移路径）直接用笔记 JSON 里的 `id` 拼文件名且未做 `is_valid_note_id` 校验，与事务写入的同类校验不一致）
- [ ] 统一限制文件名、路径分隔符、`..`、空字符串和超长输入。（路径分隔符、`..`、`.`、空串、绝对段与符号链接均已拒绝并有测试；剩余缺口是长度上限：笔记 id、附件名与导出文件名尚无显式最大长度，超长输入目前依赖文件系统 `ENAMETOOLONG` 报错）
- [x] 防止符号链接将访问范围引导到存储根目录之外。（见上一条的 `ensure_inside_storage_root`。存储根自身不解析，因此用户把 `~/OtterNote` 放在链接后面、或测试用 `/var/folders/…` 这类天生位于链接之后的临时目录都不受影响。4 个新用例 + 反向验证：删除事务写入前的守卫调用后，`a_note_that_is_a_symbolic_link_is_never_written_through` 立即变红，确认测试不是空壳；`an_images_directory_behind_a_symbolic_link_is_never_written_through` 断链目标目录始终为空）
- [x] 使用临时文件加原子 rename 写入 JSON，避免崩溃产生半文件。（既有 `atomic_write_bytes` 与事务恢复机制，已有测试覆盖）
- [ ] 为写入失败提供用户可见的错误反馈。（部分完成：状态栏提示已存在，但失败路径尚未系统梳理）
- [ ] 明确备份文件的数量、清理和恢复策略。（代码已有备份与保留期逻辑，但尚未形成文档）
- [x] 为数据版本迁移增加测试。（`legacy_root_state_is_migrated_to_current_data_version` 等，共 32 个 Rust 用例通过）
- [x] 关闭「开发构建写进真实数据目录」的旁路。（引导配置 `storage.json` 位于 `app_config_dir()`，debug 与 release 共用；一旦用户在设置里选过自定义目录，debug 构建也会落到 `~/OtterNote`，检出目录下的 `data` 保护失效。现在把决策抽成 `choose_storage_root`：`OTTERNOTE_DATA_DIR` 显式指定时优先且可信（同时重定位存储根与引导配置，配合 `ensure_parent_directory` 保证首次写入不失败），否则解析出 `$HOME/OtterNote` 时 debug 构建一律返回错误。纯函数与端到端各有测试：6 个新 Rust 用例覆盖空白值、路径边界、拒绝与放行、优先级、`~` 展开、父目录创建；真实 debug 二进制在假 `HOME` 沙箱里做对照实验（允许路径 → 确实建出 `notes/`、`state.json`；指向 `$HOME/OtterNote` → 一个文件都没创建；显式 `OTTERNOTE_DATA_DIR` → 落到 scratch））

重点测试输入：

- `../state.json`
- `/tmp/other-file`
- Windows 风格的 `..\\secret`
- 空文件名和超长文件名
- Unicode 文件名
- 指向存储目录外部的符号链接

验收标准：

- 前端传入的路径不能访问存储根目录之外的文件。
- 应用异常退出后，核心 JSON 仍可解析或可以从备份恢复。
- 持久化失败不会被静默吞掉。
- 旧版本数据可以迁移到当前版本。

### 阶段三：测试与质量门禁

优先级：P1。目标是让后续重构和社区 PR 有可靠的回归保护。

任务：

- [x] 增加 Vitest 配置和统一测试环境。（`vitest.config.ts` 与 `src/test/setup.ts`）
- [x] 为 `store.ts` 增加创建、更新、删除、撤销和 Todo 同步测试。（`src/store.test.ts`，含撤销栈边界与 Todo 状态同步）
- [x] 为 `storage.ts` 增加 hydration、连续写入、写入失败和重试测试。（`src/storage.test.ts`，含写入合并与失败上报）
- [x] 为 Markdown URL、附件引用和导出文件名工具函数增加测试。（`src/lib/markdown.test.ts`、`src/lib/attachments.test.ts`、`src/lib/files.test.ts`）
- [x] 为 Rust 增加路径校验、数据迁移、损坏恢复、附件命名和搜索索引测试。（前四项已覆盖；搜索索引重建目前只有实现，缺专门用例）
- [x] 决定是否保留 Playwright：短期不维护 E2E 时移除依赖，保留则补配置和关键流程测试。（决定移除依赖，E2E 待后续单独规划）
- [x] 增加 ESLint 和 Prettier（或统一使用 Biome）。（ESLint flat config 加 Prettier；React Compiler 期规则暂降为 warning，现存 13 条待收敛）
- [x] 增加 `typecheck`、`lint`、`format:check` 和 Rust 检查脚本。

建议的本地质量检查：

```sh
npm ci
npm run typecheck
npm run lint
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

### 阶段四：数据契约和架构文档

优先级：P1。目标是把本地数据定义为稳定、可理解、可恢复的公开契约。

新增文档：

- `docs/data-format.md`：`state.json`、`notes/*.json`、图片和搜索索引格式。
- `docs/storage.md`：默认路径、迁移、备份、恢复和手动处理方式。
- `docs/architecture.md`：前端、Zustand、Tauri command 和 Rust 存储层关系。
- `docs/adr/`：记录重要架构决策。

任务：

- [ ] 区分核心用户数据、可重建缓存和本机 UI 配置。
- [ ] 说明 `data_version` 的语义和迁移规则。
- [ ] 明确搜索索引是否可以删除后重建。
- [ ] 明确原图、预览图、笔记引用和孤立附件的生命周期。
- [ ] 提供完整备份和恢复步骤。

### 阶段五：前端和 Rust 模块化

优先级：P1。目标是降低社区贡献者修改代码的成本，不改变用户行为。

建议的前端结构：

```text
src/
  app/
  components/
    common/
    editor/
    images/
    layout/
    notes/
    todos/
  hooks/
  pages/
  services/
  store/
  lib/
```

建议的 Rust 结构：

```text
src-tauri/src/
  commands/
  storage/
  attachments/
  search/
  windows/
  error.rs
  lib.rs
```

迁移顺序：

1. 先提取纯函数和类型。
2. 再提取 `storage.ts`、图片、搜索和导出服务。
3. 再拆分页面和高内聚组件，如 `NoteDetail`、`TodosPage`、`ImagesPage` 和 `SettingsPage`。
4. 最后让 `App` 只负责应用组装、布局和窗口模式判断。
5. 每次拆分后运行类型检查、测试和构建。

验收标准：

- `src/main.tsx` 不再承载全部页面和业务逻辑。
- `lib.rs` 只负责应用注册和模块组装。
- 重构不改变已公开的数据格式和用户行为。
- 每个模块有清晰的输入、输出和错误边界。

### 阶段六：CI 与跨平台发布

优先级：P1。目标是让用户直接下载应用，让贡献者通过自动检查验证 PR。

任务：

- [x] 增加 GitHub Actions：TypeScript、Lint、Vitest、Rust fmt、Clippy、Rust test 和构建。（`.github/workflows/ci.yml`：frontend 作业跑 typecheck、lint、format:check、Vitest 与构建；rust 作业跑 fmt、`clippy -D warnings`、test）
- [x] 在 macOS、Ubuntu 上运行 CI 矩阵。（Rust 作业为 macOS + Ubuntu 矩阵；frontend 作业在 Ubuntu 运行。平台范围已确定为 macOS 与 Linux，不支持 Windows）
- [ ] 增加 Dependabot 或 Renovate。
- [ ] 增加 CodeQL、`cargo audit`、npm audit 和 gitleaks。
- [ ] 配置 GitHub Issue 模板和 Pull Request 模板。
- [ ] 配置 GitHub Releases，产出 macOS（Intel/Apple Silicon）与 Linux 安装包。（`.github/workflows/release.yml` 已创建：tag 触发，矩阵为 macOS arm64、macOS x64、Ubuntu 22.04，构建前校验 tag 与应用版本一致，产物上传后由 `gh release create` 发布。尚未实测：本机未安装 `gh`，只有推送 `v*` tag 才能验证。Linux 上 `all` 可能额外产出 rpm，未在文档中承诺）
- [ ] 为安装包生成 SHA256 校验文件和变更说明。（release 工作流用 `sha256sum ./*` 生成并随发行版上传，变更说明走 `--generate-notes`；脚本在文件存在时自动校验、哈希不匹配即中止，文件缺失或未列出该资产时只告警并继续，因此这一项不再是脚本可用的硬前置，但发布仍应产出）
- [ ] 先采用手动更新，后续再评估 Tauri updater、签名和回滚机制。

#### 安装分发方案

发布版本需要同时提供面向普通用户和开发者的安装入口。三种入口的职责不同，不应把 `npm install` 当作桌面应用安装的唯一方式：

实现状态（2026-09-17）：

- `scripts/install.sh` 已实现 macOS 与 Linux 安装：识别操作系统与 CPU 架构、支持 `--version`/`--install-dir`/`--dry-run`/`--uninstall`/`--yes`/`--base-url` 以及对应环境变量、全程不调用 `sudo`，并说明卸载方式与数据目录不受影响。发布提供 `SHA256SUMS` 时自动校验，哈希不匹配即中止安装，清单缺失或未列出该资产时仅告警并继续（避免用维护者的疏漏挡住用户）。已用伪造 release、真实 dmg 和桩 `uname` 完成 41 项端到端验证（26 项主流程 + 8 项 Linux 分支 + 7 项 README 里的 `curl | sh -s --` 管道用法）。
- 测试暴露并修复了一个真实缺陷：脚本把 `INSTALL_DIR=""` 写在参数解析之前，导致文档承诺的 `INSTALL_DIR` 环境变量被静默清空、安装落到默认目录；现已改为 `${INSTALL_DIR:-}`，并补上「环境变量生效」「`--install-dir` 优先于环境变量」「无终端时提示 `--yes`」等用例。
- `packages/npm-cli`（包名 `otter-note`）已实现 `npm install -g otter-note` 一条命令：安装时下载、校验并安装桌面应用，另提供 `otter-note install|uninstall|launch|--version`。为避免两套安装逻辑漂移，包内不重写逻辑，`prepack` 阶段把仓库根的 `scripts/install.sh` 与 `LICENSE` 拷进包内并调用前者；声明了 Node.js 版本、`os`/`cpu` 支持范围，不支持平台时只告警、不让 `npm install` 失败。已用真实 tarball 完成 21 项端到端验证（`npm pack` 内容白名单、临时 prefix 全局安装、postinstall 完成安装、CLI 各子命令、卸载需确认、`OTTERNOTE_SKIP_INSTALL`、以及 `/Applications` 未被改动）。启动路径顺带消除一个潜伏竞态：原先 `spawn` 之后立刻 `process.exit()`，可能丢掉启动；现在等待 `spawn` 事件再 `unref`，并以 `process.exitCode` 退出。
- npm 发布闸门：`scripts/check-npm-release.mjs` 用 22 项断言固化两条渠道的对齐关系（三处版本号一致、根包保持 `private`、GitHub slug 一致、`os`/`cpu` 与 Windows 拒绝、`lib/platform.js` 的资产名与 `install.sh` 的 `asset_candidates()` 逐字一致（macos/linux × 架构共 4 组，用哨兵版本 `0.0.0-consistency-check` 比对）、macOS 镜像名跟随 `tauri.conf.json` 的 `productName`、默认安装目录规则一致（`/Applications` 与 `XDG_BIN_HOME`→`~/.local/bin`）、`files` 白名单齐全、`bin` 带 shebang、零依赖、`prepack`/`postinstall`/`prepublishOnly` 已接线）。它同时挂在 `prepublishOnly` 与 CI 的 frontend job（`Build frontend` 之后），因此任何一边改名字都会在 PR 上红。`scripts/npm-release.sh` 负责编排：工作区检查 → 一致性闸门 → 全量质量门 → 确认对应 GitHub release 已存在（`postinstall` 要下载它；缺失时真实发布会中止，`--dry-run` 只提示）→ 展示 tarball → 确认后 `npm publish`；它从不改写版本号（唯一真源是 `src-tauri/tauri.conf.json`），也不打 tag。实测：在仓库镜像上注入 7 种漂移（版本不一致、根包取消 private、安装脚本资产名改动、默认安装目录改动、`prepublishOnly` 脚本名被改、GitHub slug 改动、`bin` 文件缺失）全部以 exit 1 被拒绝并指出具体断言，还原后复通；`sh scripts/npm-release.sh --dry-run --yes --skip-gates` 全链跑通（tarball 6 文件 / 7.5 kB，正确报告 `v0.1.0` release 尚不存在）。`npm view otter-note` 返回 404，包名可用。用法见 `CONTRIBUTING.md` 的「Releasing」与 `packages/npm-cli/README.md`。
- 端到端安装测试的安全边界（已写入 `CONTRIBUTING.md` 的「Testing the installer」）：所有用例都显式指向临时目录；依赖环境变量而非 `--install-dir` 的用例先用 `--dry-run` 预检解析结果，一旦解析到临时目录之外立即中止（这正是当初误删真实安装的路径）；套件首尾对 `/Applications/OtterNote.app` 与 `~/OtterNote` 做指纹校验，笔记目录按 inode/存在性判断以容忍正在运行的正式版写入；不真启动 GUI（用 PATH 上的桩 `open` 验证启动路径）；只按 PID 或精确临时路径结束进程；真实安装只由一次性脚本完成。
- `src-tauri/tauri.conf.json` 的 `bundle.targets` 已从 `["app"]` 改为 `all`，release 构建实测产出 `OtterNote_0.1.0_aarch64.dmg`（9.5 MB），与脚本的首选资产名一致；把它当作真实 release 走一遍安装后，装出的二进制与 `src-tauri/target/release/otter-note` 字节一致，且不含 debug 专属代码（debug 产物中因 `development_data_root` 会内联检出路径，可作为判别依据）。
- 存储目录在真实 release 产物上实测：以 `/` 为工作目录、`HOME` 指向临时目录启动，数据落在 `$HOME/OtterNote`，既不写工作目录也不产生 `/data`。
- 在 macOS 上打包 dmg 会驱动 Finder 排布窗口，缺少自动化权限时报 `-1743`；`CI=true` 可跳过这一美化步骤（已实测），GitHub Actions 上默认即为该情况。
- 仍然阻塞：Release 工作流尚未实测，且本仓库还没有 `v*` tag，因此没有可安装的真实发布资产；npm 包也尚未发布到 npm registry（需要账号凭据）。校验文件已不再是脚本的硬前置。
- 平台范围已确定为 macOS 与 Linux，不支持 Windows；README、CI 矩阵和打包目标均已按此收敛。
- 待验证：Linux 的 `.deb`/`.AppImage` 文件名取自 Tauri 约定，尚未在 Linux 上实测（macOS 的 dmg 文件名已实测）。

1. **GitHub Release 一键安装**
   - 每个版本提供 macOS 和 Linux 对应安装包。
   - README 的下载区域直接链接到最新稳定版本或 Releases 页面。
   - 安装包命名包含平台、架构和版本，例如 `OtterNote-0.1.0-aarch64.dmg`。
   - Release 同时提供 SHA256 校验文件、变更说明和已知问题。
   - macOS 应用需要处理签名和公证；Linux 需要说明 AppImage、Deb 等格式的差异。

2. **curl 脚本安装**
   - 提供稳定地址，例如 `https://otternote.example.com/install.sh`，脚本根据操作系统和 CPU 架构下载对应 Release 资产。
   - 脚本只支持明确的平台，无法识别平台时必须安全退出并给出手动下载地址。
   - 下载后校验 SHA256，校验失败不得继续安装。
   - 支持 `VERSION`、`INSTALL_DIR` 和 `DRY_RUN` 等参数，便于固定版本、预览动作和自动化部署。
   - 默认不使用 `sudo`；确需写入系统目录时必须显式提示并征得用户确认。
   - 不在脚本中硬编码不可审计的远程命令；脚本内容、版本映射和校验逻辑必须纳入仓库审查。
   - 提供卸载方式，并说明脚本不会删除用户数据目录 `./data` 或 `~/OtterNote`。
   - 在 README 中使用固定版本 URL 或展示脚本源码，避免无提示地执行远程内容。

   示例入口：

   ```sh
   curl -fsSL https://otternote.example.com/install.sh | sh
   ```

   生产环境更推荐先下载并审查脚本，再执行：

   ```sh
   curl -fsSLO https://otternote.example.com/install.sh
   sh install.sh
   ```

3. **npm install 安装**
   - `npm install` 用于开发者安装源码依赖、运行前端开发环境和执行构建，不等同于安装已打包的桌面应用。
   - 如果希望支持 `npm install -g otter-note`，需要额外发布一个 npm CLI 包，用于下载、校验并启动对应平台的桌面安装包。
   - npm 包不能把 Rust 编译工具链作为普通用户的隐式前置条件。
   - npm 包需要声明 Node.js 版本、平台和架构支持范围，并提供 `npm uninstall -g otter-note` 的清理说明。
   - 包内不应携带未压缩的大型安装资源；优先在安装时从 Release 下载，并校验版本和哈希。
   - 需要明确区分以下命令：

   ```sh
   # 开发者：安装源码依赖
   npm install

   # 开发者：启动 Web 开发环境
   npm run dev

   # 普通用户：如果发布 npm CLI，则安装桌面应用
   npm install -g otter-note
   ```

   第一阶段建议先支持源码 `npm install` 和 GitHub Release；npm CLI 可作为第二阶段发布渠道，避免过早维护额外的下载器和平台适配逻辑。

   实现状态（2026-09-17）：`packages/npm-cli` 已完成上述约束——声明 `engines.node >= 18`、`os` 为 darwin/linux、`cpu` 为 x64/arm64；不需要 Rust 工具链；包体约 8 KB（只含 CLI 与 `install.sh`，安装包在安装时从 Release 下载并校验哈希）；`README.md` 说明 `npm uninstall -g otter-note` 只移除 CLI、不动应用与笔记。尚未 `npm publish`。

验收标准：

- PR 在合并前必须通过自动化质量检查。
- 用户无需安装 Rust 即可下载并运行发布版本。
- Release 能说明支持平台、已知问题和数据迁移注意事项。
- 普通用户可以通过 GitHub Release 下载并完成安装。
- macOS/Linux 用户可以通过 `curl` 脚本安装，脚本具备平台识别、哈希校验、失败退出和卸载说明。
- 开发者可以通过 `npm install` 安装依赖并完成开发构建。
- 如果提供 npm CLI，`npm install -g otter-note` 在支持的平台上可以下载、校验并安装对应版本。
- 三种安装方式都不会默认删除用户数据。

## 建议提交拆分

每个提交只解决一个主题，建议使用以下顺序：

1. `chore: add license and open source documentation`
2. `chore: pin node and rust toolchains`
3. `chore: add formatter and lint configuration`
4. `test: establish frontend and rust test commands`
5. `security: harden tauri csp and capabilities`
6. `fix: validate all storage paths`
7. `docs: document storage format and backup`
8. `refactor: extract storage and domain modules`
9. `refactor: split note and todo pages`
10. `ci: add cross-platform quality checks`
11. `ci: add release packaging workflow`
12. `feat: add verified curl installer`
13. `feat: publish npm desktop installer cli`
14. `chore: optimize application assets`

## 最小可开源版本

如果希望尽快公开仓库，第一版不必等待全部重构完成，但必须满足：

- 有 LICENSE、README、贡献指南和安全报告渠道。
- 干净环境可以完成安装、测试和构建。
- 已完成 Tauri CSP、capabilities 和路径安全审计。
- 有基础 CI，前端和 Rust 测试通过。
- 有数据格式、备份、恢复和已知限制说明。
- 至少提供 macOS 与 Linux 的可下载安装包。
- 明确当前不支持账号、云同步和多人协作。

## 暂不处理

- 不重写现有 Tauri + React 技术栈。
- 不在开源基线阶段引入账号系统和后端服务。
- 不在没有迁移测试前改变存储格式。
- 不为模块化引入新的状态管理框架。
- 不在没有签名、失败处理和回滚方案前启用自动更新。

## 总体顺序

```text
许可证与文档
  -> CI 与测试
  -> 安全审计
  -> 数据格式稳定
  -> 前端/Rust 模块化
  -> 跨平台发布
```

每完成一个阶段，应更新本文档中的任务状态，并在对应提交或 PR 中记录验证命令和结果。
