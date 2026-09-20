# OtterNote release state

唯一版本真源是 `src-tauri/tauri.conf.json`。tag、GitHub release、npm 包、dmg
文件名全部由它派生，任何一处不齐都会被 `release/npm/verify.mjs` 拦下。

## 当前状态

| curl 安装通道 | 可用（`release/install/install.sh`） |
| npm `otter-note` | **已发布 0.1.0**（latest，由本机 publish.sh 首发） |
| GitHub release | **已发布 v0.1.0**（dmg ×2 + AppImage + deb + SHA256SUMS） |
| 版本 tag | **v0.1.0 已打** |
| 当前版本 | 0.1.0（`src-tauri/tauri.conf.json`） |

## 渠道拓扑

```
src-tauri/tauri.conf.json            ← 唯一版本真源
        │
        ├─ push v<version> tag ──→ .github/workflows/release.yml
        │                              ├─ build：桌面 bundle（macOS×2 + Linux）
        │                              ├─ release：GitHub release（dmg/AppImage/deb + SHA256SUMS）
        │                              └─ publish-npm：release/npm/publish.sh --yes --skip-gates ─→ npm 发布
        │                                    （Trusted publishing / OIDC：npm 侧 trusted publisher
        │                                      校验本 workflow 身份，无需任何 Secret）
        ├─ curl 通道：release/install/install.sh（从 main 分支取，README curl | sh）
        └─ 手动备用：release/npm/publish.sh（两个通道的闸门照跑，发布前二次确认）
                                                     │
            release/npm/verify.mjs（CI 每个 PR + 发布前）┘ 断言桌面与 npm 两渠道对齐
```

## 一次发布的顺序（checklist）

0. （一次性）npm 上 claim `otter-note` 包名，包 Settings → Trusted publishing 配
   GitHub Actions：org `sanm00`、repo `OtterNote`、workflow `release.yml`、勾选允许
   `npm publish` 直接发布。完成后流水线 npm 步骤走 OIDC，无需任何 Secret。
1. `sh release/desktop/desktop.sh --bundles app` 本地打 `.app` 自行验证。
2. bump `src-tauri/tauri.conf.json` 的 `version`（或开发期直接带新版本开发），提交并推 `main`（过 CI）。
3. 推 `v<version>` tag：流水线自动 build → 建 GitHub release → 发布 npm `otter-note@<version>`。
4. 检查流水线结果：桌面 bundle、GitHub release、`npm view otter-note version`。
5. 手动备用（流水线 npm 步骤出错时）：`sh release/npm/publish.sh --dry-run` 预览后正式发布。
6. 本文件更新「当前状态」，记录进下面表格。

## 已发布记录

| 版本  | GitHub release                                 | npm otter-note  | 日期       | 备注                                                                                        |
| ----- | ---------------------------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------- |
| 0.1.0 | v0.1.0（dmg ×2 + AppImage + deb + SHA256SUMS） | 0.1.0（latest） | 2026-09-20 | 首发：GitHub Actions 建 release；npm 由本机 publish.sh 发布；此后流水线 publish-npm 走 OIDC |
