# OtterNote release state

唯一版本真源是 `src-tauri/tauri.conf.json`。tag、GitHub release、npm 包、dmg
文件名全部由它派生，任何一处不齐都会被 `release/npm/verify.mjs` 拦下。

## 当前状态

| curl 安装通道 | 可用（`release/install/install.sh`） |
| npm `otter-note` | 未发布（`npm view otter-note` 返回 404，包名可用） |
| GitHub release | 未发布 |
| 版本 tag | 尚未打（无 `v*` tag） |
| 当前版本 | 0.1.0（`src-tauri/tauri.conf.json`） |

## 渠道拓扑

```
src-tauri/tauri.conf.json            ← 唯一版本真源
        │
        ├─ push v<version> tag ──→ .github/workflows/release.yml
        │                              ├─ build：桌面 bundle（macOS×2 + Linux）
        │                              ├─ release：GitHub release（dmg/AppImage/deb + SHA256SUMS）
        │                              └─ publish-npm：release/npm/publish.sh --yes --skip-gates ─→ npm 发布
        │                                    （需要仓库 Secret NPM_TOKEN；未配置时该步 error 中止）
        ├─ curl 通道：release/install/install.sh（从 main 分支取，README curl | sh）
        └─ 手动备用：release/npm/publish.sh（两个通道的闸门照跑，发布前二次确认）
                                                     │
            release/npm/verify.mjs（CI 每个 PR + 发布前）┘ 断言桌面与 npm 两渠道对齐
```

## 一次发布的顺序（checklist）

0. （一次性）npm 上 claim `otter-note` 包名、生成 Automation token，存为仓库 Secret `NPM_TOKEN`。
1. `sh release/desktop/desktop.sh --bundles app` 本地打 `.app` 自行验证。
2. bump `src-tauri/tauri.conf.json` 的 `version`（或开发期直接带新版本开发），提交并推 `main`（过 CI）。
3. 推 `v<version>` tag：流水线自动 build → 建 GitHub release → 发布 npm `otter-note@<version>`。
4. 检查流水线结果：桌面 bundle、GitHub release、`npm view otter-note version`。
5. 手动备用（流水线 npm 步骤出错时）：`sh release/npm/publish.sh --dry-run` 预览后正式发布。
6. 本文件更新「当前状态」，记录进下面表格。

## 已发布记录

| 版本 | GitHub release | npm otter-note | 日期 | 备注 |
| ---- | -------------- | -------------- | ---- | ---- |
