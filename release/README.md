# release/

发布相关的全部内容集中在 `release/`，按照**安装通道**组织。

| 目录       | 安装通道                                    | 内容                                                                                       |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `state/`   | （跨渠道）                                  | `STATUS.md`：版本账本、渠道现状、发布 checklist                                            |
| `install/` | **curl 一键安装**（普通用户）               | `install.sh`：macOS/Linux 安装器，README 的 `curl \| sh` 即指它                            |
| `desktop/` | **桌面二进制 / GitHub release**             | `desktop.sh`：打 dmg/AppImage/deb bundle                                                   |
| `npm/`     | **npm 安装**（`npm install -g otter-note`） | `assemble.mjs`（组装包）、`publish.sh`（发布）、`verify.mjs`（闸门）、`package/`（包源码） |

## 三种安装方式

| 方式        | 用户命令                                          | 来源                                                                                   |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| curl 直接装 | `curl -fsSL .../release/install/install.sh \| sh` | `release/install/install.sh`                                                           |
| 手动下载    | GitHub release 的 dmg / AppImage / deb            | `release/desktop/desktop.sh` 打出的 bundle                                             |
| npm 装      | `npm install -g otter-note`                       | `release/npm/`（包内 `scripts/install.sh` 组装时从 `release/install/install.sh` 拷入） |

三个通道独立存在，但**安装逻辑只有一份**：npm 包发布时由 `release/npm/assemble.mjs`
把 `release/install/install.sh` 拷进包内 `scripts/install.sh`，包内不重写逻辑。

## 关键不变式

- **版本唯一真源**是 `src-tauri/tauri.conf.json`。`release/npm/verify.mjs` 断言三处
  （根 `package.json`、`tauri.conf.json`、组装出的 npm 包）一致。
- **npm 包不纳入仓库跟踪**。`release/npm/assemble.mjs` 在发布前把
  `release/npm/package/`（bin、lib、README）加 `release/install/install.sh`、LICENSE
  组装到 `.npm-pkg/`；`release/npm/verify.mjs` 也把它跑进临时目录再校验。
- **npm 发布只能在 GitHub release 后面**。`release/npm/publish.sh` 先确认 `v<version>`
  release 存在才允许发布，否则用户 `npm install` 会下载到 404。

## 发布流程（详见 state/STATUS.md）

```
打 tag v<version> ─→ .github/workflows/release.yml
                          ├─ build：桌面 bundle（macOS×2 + Linux）
                          ├─ release：GitHub release（桌面 bundle + SHA256SUMS）
                          └─ publish-npm：release/npm/publish.sh --yes --skip-gates ─→ npm 发布 otter-note
                                （Trusted publishing / OIDC：npm 侧校验 workflow 身份，无 Secret）
  手动备用（流水线 npm 步骤出错时）：sh release/npm/publish.sh
                                │
      （内侧：npm/assemble + npm/verify）
```

两个自动化闸门保证「桌面渠道」与「npm 渠道」不会悄悄漂移：

- **CI**：每个 PR 在 `Build frontend` 后跑 `node release/npm/verify.mjs`。
- **发布前**：`release/npm/publish.sh` 自身先跑同一条闸门，再跑全量质量门
  （流水线里用 `--skip-gates` 复用推 main 时已过的质量门）。

## 本机常用命令

```sh
sh release/desktop/desktop.sh --bundles app     # 打桌面 .app（跳过 dmg 的 Finder 步骤）
node release/npm/verify.mjs                     # 只跑一致性闸门（等价 CI 检查）
sh release/npm/publish.sh --dry-run             # 发布前走一遍全流程，不真正发布
sh release/npm/publish.sh                       # 正式发布 npm 包
```
