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

发起一次发布 = 推一个 `v<version>` tag。流水线 `.github/workflows/release.yml` 接手全部：
桌面 bundle → GitHub release → npm 发布，无需任何密钥（OIDC）。

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

### 发布一个新版本（完整步骤）

0. **只用做一次**：npm 上确认 `otter-note` 包名归你，并在
   <https://www.npmjs.com/package/otter-note/settings> → **Trusted publishing** 配好
   GitHub Actions：org `sanm00`、repo `OtterNote`、workflow `release.yml`、勾选允许
   `npm publish` 直接发布。配好后流水线 npm 步骤走 OIDC，永远不需要 npm token。

1. **改版本号**。唯一真源是 `src-tauri/tauri.conf.json` 的 `version`，同时把根
   `package.json`、`src-tauri/Cargo.toml` 与两个 lock 文件（`package-lock.json`、
   `Cargo.lock`）里的版本改成一模一样的值，否则 CI 的闸门会拦。

   ```sh
   node -p "require('./src-tauri/tauri.conf.json').version"   # 确认
   ```

2. **本机预检**（可选但推荐）：跑一致性闸门，确认 23 项全过。

   ```sh
   node release/npm/verify.mjs
   ```

3. **提交并推 main**。CI 会在 `main` 上再跑一遍完整闸门，绿了才继续。

   ```sh
   git add -A && git commit -m "Bump version to vX.Y.Z"
   git push origin main
   ```

4. **打 tag 并推送**——这一步触发发布流水线。

   ```sh
   git tag vX.Y.Z        # 必须与 tauri.conf.json 的 version 完全一致（不带 v）
   git push origin vX.Y.Z
   ```

5. **等流水线**（约 10 分钟，构建 3 个平台）。自动完成：桌面 bundle → GitHub
   release（dmg ×2 + AppImage + deb + SHA256SUMS）→ npm 发布 `otter-note@X.Y.Z`。

6. **验证发布结果**：

   ```sh
   npm view otter-note version           # 应为 X.Y.Z
   npm view otter-note time."X.Y.Z"      # 发布时间
   curl -fsSL https://github.com/sanm00/OtterNote/releases/tag/vX.Y.Z  # 桌面资产
   ```

   发布后无人维护时，可在 CI 里手动重跑失败 job；tag 指向错误提交也可
   `git tag -f vX.Y.Z <sha> && git push origin vX.Y.Z --force` 重新触发。

7. **更新账本**：把本版记进 `release/state/STATUS.md`「当前状态」与「已发布记录」。

### 手动备用路径（不对正常发布流程产生依赖）

流水线 npm 步骤出错时才需要，平时不要用：

```sh
sh release/npm/publish.sh --dry-run     # 每个检查都跑，什么都不发布
sh release/npm/publish.sh               # 正式发布（要求对应 GitHub release 已存在）
```

注意：本地发布必须**先有** GitHub release，否则 `postinstall` 会下载到 404；本机若
未登录 npm 会走交互式登录，账号开了 2FA 时需在浏览器完成认证。

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
