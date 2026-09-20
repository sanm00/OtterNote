# OtterNote

[![CI](https://github.com/sanm00/OtterNote/actions/workflows/ci.yml/badge.svg)](https://github.com/sanm00/OtterNote/actions/workflows/ci.yml)

**English** | [简体中文](README.zh-CN.md)

Local-first notes and ToDo app with a two-column workspace. Notes, attachments, and the search index stay on your machine.

> Status: pre-1.0 and under active development. Data formats and shortcuts may still change between releases.

## Features

- Two-column workspace with sidebar navigation and content area
- Notes list, note detail, timeline, ToDo list, images, settings, and help
- Markdown editing and preview
- Inline ToDo parsing from note content
- Notes grouped by time in the timeline view
- Image upload through the file picker or paste
- Separate preview and original image storage on desktop
- Note export to Markdown
- Global search across notes and ToDo content
- Light and dark themes
- Keyboard shortcuts with custom configuration
- Pinned note windows

## Install

Prebuilt packages are published on the [Releases page](https://github.com/sanm00/OtterNote/releases).

> No release has been published yet, so the commands below cannot work yet.
> Until the first release is out, [build from source](#build-from-source).

### One command

macOS and Linux, latest release:

```sh
curl -fsSL https://raw.githubusercontent.com/sanm00/OtterNote/main/release/install/install.sh | sh
```

Or with npm:

```sh
npm install -g otter-note
```

Both run the same installer: detect your platform, download the matching
release, verify it when checksums are published, and install the app into
`/Applications` (macOS) or `~/.local/bin` (Linux). Neither calls `sudo`, and
neither touches your notes. Start OtterNote from your launcher, or run
`otter-note`.

The first launch is blocked because builds are not signed or notarized yet.
Right-click the app and choose **Open**, or allow it under
**System Settings → Privacy & Security**.

### Options

Flags go to the script, or to `otter-note install` when you use npm:

```sh
sh install.sh --version 0.1.0                      # install a specific release
sh install.sh --install-dir "$HOME/Applications"   # choose the target directory
sh install.sh --dry-run                            # show the plan, change nothing
sh install.sh --uninstall                          # remove the app
sh install.sh --yes                                # no confirmation prompts
```

In the one-command form, pass them after `sh -s --`:

```sh
curl -fsSL https://raw.githubusercontent.com/sanm00/OtterNote/main/release/install/install.sh |
  VERSION=0.1.0 sh -s -- --dry-run
```

`VERSION`, `INSTALL_DIR`, `DRY_RUN`, `YES` and `BASE_URL` also work as
environment variables, with `OTTERNOTE_*` equivalents for the npm CLI.
`BASE_URL` points the installer at a mirror or a self-hosted build.

To read the script before running it:

```sh
curl -fsSLO https://raw.githubusercontent.com/sanm00/OtterNote/main/release/install/install.sh
less install.sh && sh install.sh
```

### Manual download

| Platform              | Package                                         |
| --------------------- | ----------------------------------------------- |
| macOS (Apple Silicon) | `OtterNote_<version>_aarch64.dmg`               |
| macOS (Intel)         | `OtterNote_<version>_x64.dmg`                   |
| Linux (x86_64)        | `otter-note_<version>_amd64.AppImage` or `.deb` |

macOS: open the `.dmg` and drag **OtterNote** into `Applications`.

Linux: `chmod +x otter-note_<version>_amd64.AppImage` and run it, or
`sudo dpkg -i otter-note_<version>_amd64.deb`. The AppImage needs `libfuse2`;
without it, run the file with `--appimage-extract-and-run`.

OtterNote supports macOS and Linux. Windows is not supported yet.

### Uninstall

```sh
otter-note uninstall          # remove the desktop app (npm install)
npm uninstall -g otter-note   # remove the CLI itself
```

Or without npm:

- **macOS**: delete `OtterNote.app`, or run `sh install.sh --uninstall`.
- **Linux**: delete the AppImage or run `sudo dpkg -r otter-note`, or
  `sh install.sh --uninstall`.

Uninstalling never deletes your notes, which stay in `~/OtterNote` (see
[Storage](#storage)).

### Verifying a download

You do not need this to install OtterNote. If you want to confirm that a
downloaded package matches what the release published, releases also carry a
`SHA256SUMS` file:

```sh
shasum -a 256 -c SHA256SUMS   # macOS
sha256sum -c SHA256SUMS       # Linux
```

This detects a corrupted or replaced download. It is not a signature and does
not replace code signing, which the builds do not have yet.

## Stack

Tauri 2, React 18, TypeScript, Vite, Tailwind CSS, Zustand, CodeMirror 6, and Rust for desktop file system access.

## Requirements

| Tool                      | Version                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| Node.js                   | 24 (see `.nvmrc`)                                                        |
| Rust                      | 1.96.0 (see `rust-toolchain.toml`)                                       |
| Tauri system dependencies | See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |

## Build from source

For contributors and for platforms without a prebuilt package.

Install dependencies:

```sh
npm install
```

Run the web preview:

```sh
npm run dev
```

Run the desktop app:

```sh
npm run tauri -- dev
```

## Storage

The app is local-first and works without a network connection.

- Development desktop builds use the `data` folder in the checkout you built from, no matter which directory the app was started from. This folder is ignored by Git, and a development build refuses to fall back onto `~/OtterNote`; set `OTTERNOTE_DATA_DIR` to keep development data somewhere else entirely (see `CONTRIBUTING.md`).
- Release desktop builds use `~/OtterNote`.
- The web preview uses browser `localStorage`.
- On desktop you can change the storage folder in Settings.
- The storage folder may itself be a symbolic link, but the files inside it may not: a link standing where a note or an attachment belongs is refused rather than followed, so a folder you import from elsewhere cannot make the app read or overwrite files outside it.

Data layout:

| Path                | Contents                         |
| ------------------- | -------------------------------- |
| `state.json`        | Application state root           |
| `notes/*.json`      | Note bundles                     |
| `images/*`          | Original and preview attachments |
| `search-index.json` | Rebuildable search index         |

Images are stored separately from note content so notes stay small and open quickly.

## Development

```sh
npm run dev                # Web preview
npm run tauri -- dev       # Desktop app
npm run typecheck          # TypeScript
npm run lint               # ESLint
npm run format:check       # Prettier check
npm test                   # Vitest
npm run build              # Frontend build
```

Rust checks:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Production build

```sh
npm run tauri -- build
```

This builds the frontend and then packages the desktop application for the current platform, using every bundle format that platform supports (`bundle.targets` is `all`). Output goes to `src-tauri/target/release/bundle/`:

| Path                                            | Contents                 |
| ----------------------------------------------- | ------------------------ |
| `macos/OtterNote.app`                           | macOS application bundle |
| `dmg/OtterNote_<version>_<arch>.dmg`            | macOS disk image         |
| `appimage/otter-note_<version>_<arch>.AppImage` | Linux portable app       |
| `deb/otter-note_<version>_<arch>.deb`           | Debian package           |

Building the `.dmg` on macOS drives Finder to lay out the disk image window. If
that is not permitted in your environment, either grant your terminal access
under **System Settings → Privacy & Security → Automation**, or skip the
cosmetic step:

```sh
CI=true npm run tauri -- build
```

The packaged artifacts can be installed directly: the `.app` by dragging it into
`Applications`, the `.dmg` and the platform installers by opening them. Locally
built artifacts are unsigned, so the first-launch warnings described under
[Install](#install) apply.

A debug bundle builds faster, but it is not the production artifact: it keeps its
data in the `data` folder of the checkout (see [Storage](#storage)), so do not
install it as your everyday app:

```sh
npm run tauri -- build --debug
```

## Privacy

OtterNote does not send note content, attachments, or usage data anywhere. Your notes stay in the storage folder described above. See [SECURITY.md](SECURITY.md) for the disclosure process for security issues.

## Known limitations

- Single machine only: there is no account system, sync, or collaboration.
- macOS and Linux only; Windows is not supported.
- No automatic updates yet; update by installing a newer release.
- Builds are not signed or notarized yet, so the first launch needs the manual
  steps described under [Install](#install).
- The storage format is still evolving; migrations are attempted automatically, but keep backups of important data.

## Documentation

- [Open-source roadmap](docs/open-source-roadmap.md): hardening, testing, modularization, and release plan.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues through the process in [SECURITY.md](SECURITY.md) rather than in a public issue.

## License

[MIT](LICENSE)
