# Contributing to OtterNote

Thanks for taking the time to contribute. This document explains how to set up the project, what quality checks are expected, and how to propose changes.

## Before you start

- For bug reports, include your operating system, OtterNote version, steps to reproduce, and any relevant log output.
- For larger features, open an issue first so the design can be discussed before you invest time in an implementation.
- Do not include private note content, screenshots of personal data, or absolute file paths that reveal private directories in issues and pull requests.

## Requirements

| Tool                      | Version                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Node.js                   | 24 (see `.nvmrc`)                                                                          |
| Rust                      | 1.96.0 (see `rust-toolchain.toml`, installed automatically by `rustup`)                    |
| Tauri system dependencies | See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform |

## Setup

```sh
git clone git@github.com:sanm00/OtterNote.git
cd OtterNote
npm install
```

`rustup` will select the pinned toolchain automatically when you run any `cargo` command inside `src-tauri`.

## Development

```sh
npm run dev              # Web preview in the browser
npm run tauri -- dev     # Desktop application
```

In development builds the desktop app stores its data in the `data` folder of the checkout you built from, regardless of the working directory the process was started with. Release builds use `~/OtterNote`. See the storage section of the README for details.

That safety net only covers the default path. A custom storage directory is remembered in an application support file that debug and release builds share, so setting one in the app's Settings screen would otherwise make even a debug build write into real user data. Two rules close that gap: a debug build **refuses to use** `$HOME/OtterNote` — every storage command then fails with an error naming `OTTERNOTE_DATA_DIR`, so the app stays empty instead of quietly editing your real notes — and setting `OTTERNOTE_DATA_DIR=/some/scratch` overrides the whole resolution, moving both the notes and that application support file into a directory you choose:

```sh
# Throwaway scratch data, useful for testing migrations or imports:
OTTERNOTE_DATA_DIR=$(mktemp -d) npm run tauri -- dev
```

Use the override instead of pointing the app at a directory by hand: it cannot be mistaken for a real installation.

## Quality checks

Run these before opening a pull request:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Fix formatting automatically with:

```sh
npm run format
npm run lint:fix
```

## Testing the installer

`release/install/install.sh` is the one script that can delete things, so tests for it
must be defensive:

- Always pass `--install-dir` (or set `INSTALL_DIR`) to a **temporary** directory. Never run the installer, and never run `install.sh --uninstall --yes`, without an explicit install directory: the default is `/Applications` on macOS and `~/.local/bin` on Linux, which is a real installation.
- Prove the resolved directory before doing anything destructive: `install.sh --dry-run` prints `install dir: ...`, so a preflight can assert the path is inside your temporary directory. A regression that ignores `INSTALL_DIR` once deleted a real `/Applications/OtterNote.app` this way.
- Prefix the suite with fingerprints of `/Applications/OtterNote.app` and `~/OtterNote` and assert at the end that they are unchanged. Identify the notes directory by inode/existence rather than content, because a running app legitimately rewrites its index and state files.
- Do not start a GUI app from a test. A launch inherits the real `HOME`, so it would write to the user's `~/OtterNote`; verify the launch command with a stub `open` on `PATH` instead.
- Kill only processes you started, and only by PID or by an exact temporary path.

## Releasing

The app itself is published by pushing a `v<version>` tag, which runs `.github/workflows/release.yml`. Tag versions must match `src-tauri/tauri.conf.json`, which is the only place a version number is written; `release/npm/verify.mjs` fails if anything else disagrees.

The `otter-note` npm package is a thin installer that downloads a GitHub release, so it must be published **after** that release exists. A fresh tag publishes npm automatically: the `publish-npm` job runs `release/npm/publish.sh` right after the GitHub release is created. It publishes with **trusted publishing (npm OIDC)** — no long-lived token is stored in this repository. npm validates the identity against the trusted publisher configured on the package's Settings page (Trusted publishing) with workflow filename `release.yml` and direct `npm publish` allowed.

For local or emergency publishing, use `release/npm/publish.sh` rather than `npm publish` directly:

```sh
sh release/npm/publish.sh --dry-run     # every check, nothing published
sh release/npm/publish.sh               # publish
```

It runs the consistency check and the full quality gates, refuses to publish when the matching GitHub release is missing, and shows the tarball contents before asking for confirmation. It never creates tags and never rewrites versions. It also assembles the package: `release/npm/assemble.mjs` builds the generated npm package into `.npm-pkg/` right before packing, so the script is the only supported publish path. CI runs the same consistency check on every pull request, so the two install channels cannot drift apart silently: the asset names and default install directories in `release/npm/package/lib/platform.js` have to keep matching `release/install/install.sh`.

## Code style

- Formatting is enforced by Prettier and Rustfmt. Do not reformat unrelated code in the same pull request.
- Linting is enforced by ESLint. Warnings are allowed but should not be added without a reason.
- TypeScript is `strict`. Avoid `any`; prefer explicit types or `unknown` plus narrowing.
- Follow the conventions already present in the file you are editing.

## Rust guidelines

- Validate every path received from the frontend. Reject absolute paths, path separators inside file names, `..` segments, and empty input.
- Never write outside the active storage root.
- Keep file writes atomic: write to a temporary file and rename it into place.
- Return `Result<_, String>` from commands and surface failures to the caller instead of silently ignoring them.
- Add unit tests under `#[cfg(test)]` for storage, migration, and validation changes.

## Tests

- Frontend tests use Vitest and live next to the code as `*.test.ts` or `*.test.tsx`.
- Rust tests live in `src-tauri/src/lib.rs` under `#[cfg(test)]`.
- When fixing a bug, add a test that fails before the fix.
- When changing the on-disk format, add a migration test and document the change.

## Commit messages

Keep the subject in the imperative mood and, where useful, prefix it with a scope:

```text
fix: validate attachment file names before deleting
refactor: extract markdown helpers from main.tsx
docs: document the state.json layout
```

Keep data migration, refactoring, and behavior changes in separate commits.

## Pull requests

- Keep pull requests focused on a single concern.
- Describe what changed, why it changed, and how you verified it.
- Include the commands you ran and their result.
- Screenshots or short recordings are helpful for user interface changes.
- Update documentation when you change storage, configuration, or user-facing behavior.

## Project layout

| Path                   | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `src/main.tsx`         | Application entry, layout, and currently most of the user interface   |
| `src/store.ts`         | Zustand store, domain types, and persistence configuration            |
| `src/storage.ts`       | Frontend access to Tauri storage commands and browser fallback        |
| `src/todo-parser.ts`   | Markdown ToDo parsing helpers                                         |
| `src-tauri/src/lib.rs` | Tauri commands, storage layout, search index, and attachment handling |
| `docs/`                | Architecture, storage, and roadmap documentation                      |

`src/main.tsx` and `src-tauri/src/lib.rs` are larger than we would like. Splitting them into modules is in progress; see [docs/open-source-roadmap.md](docs/open-source-roadmap.md).

## Code of conduct

Be respectful to other people. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for what is
not acceptable and how to report a problem.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
