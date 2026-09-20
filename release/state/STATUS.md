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
        ├─ push v<version> tag ──→ .github/workflows/release.yml ──→ GitHub release（dmg/AppImage/deb + SHA256SUMS）
        ├─ curl 通道：release/install/install.sh（从 main 分支取，README curl | sh）
        └─ npm 通道：release/npm/publish.sh ──→ release/npm/assemble.mjs ──→ .npm-pkg ──→ npm 发布
                                                     │
            release/npm/verify.mjs（CI 每个 PR + 发布前）┘ 断言桌面与 npm 两渠道对齐
```

## 一次发布的顺序（checklist）

1. `sh release/desktop/desktop.sh --bundles app` 本地打 `.app` 自行验证。
2. bump `src-tauri/tauri.conf.json` 的 `version`（或开发期直接带新版本开发）。
3. 推 `v<version>` tag → GitHub Actions 产出桌面 bundle 与 SHA256SUMS 并建 GitHub release。
4. 确认 release 就绪后：`sh release/npm/publish.sh --dry-run` 预览 tarball。
5. `sh release/npm/publish.sh` 正式发布（会再次跑 `verify.mjs` 与全量质量门）。
6. 本文件更新「当前状态」，记录进下面表格。

## 已发布记录

| 版本 | GitHub release | npm otter-note | 日期 | 备注 |
| ---- | -------------- | -------------- | ---- | ---- |
