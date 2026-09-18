# otter-note

Installer and launcher for the [OtterNote](https://github.com/sanm00/OtterNote)
desktop app. Local-first notes and todos; your data never leaves your machine.

## Install

```sh
npm install -g otter-note
```

That single command downloads the release for your machine, verifies its
checksum and installs the desktop app:

- **macOS**: `OtterNote.app` in `/Applications`, from the release `.dmg`
- **Linux**: the AppImage at `~/.local/bin/otter-note`

Then start it with:

```sh
otter-note
```

## Other commands

```sh
otter-note install --version 0.1.0       # install a specific release
otter-note install --install-dir ~/Apps  # install somewhere else
otter-note install --dry-run             # show what would happen
otter-note uninstall                     # remove the desktop app
otter-note --help
```

## Requirements

- Node.js 18 or newer (only for this installer; the app itself needs no runtime)
- macOS or Linux on x64 or arm64. Windows is not supported.
- The installer never calls `sudo` and never touches your notes in `~/OtterNote`.

Set `OTTERNOTE_SKIP_INSTALL=1` to install the CLI without downloading the app,
and `OTTERNOTE_VERSION` / `OTTERNOTE_INSTALL_DIR` / `OTTERNOTE_BASE_URL` to
change what gets installed.

## Uninstall

```sh
otter-note uninstall       # remove the desktop app
npm uninstall -g otter-note   # remove this CLI
```

Removing the CLI does not remove the desktop app or your notes.

## Releasing

The CLI installs the latest GitHub release by default, so shipping a new app
release does not require a new npm publish. When the CLI itself changes, publish
it from the repository root with the release script:

```sh
sh scripts/npm-release.sh --dry-run --skip-gates   # inspect the tarball only
sh scripts/npm-release.sh                          # publish
```

The script refuses to publish before the matching GitHub release exists, because
`postinstall` is what downloads it. It also re-checks that this package agrees
with `scripts/install.sh` on versions, asset names and default install
directories; the same check runs from `prepublishOnly` and in CI, so a plain
`npm publish` cannot ship a package that fails on some platform either.

Version numbers are never rewritten by the script: `src-tauri/tauri.conf.json` is
the source of truth. Bump `version` here in the same change when the CLI version
should track the app version. The tarball is a few KB: `scripts/install.sh` and
the LICENSE are bundled at pack time and the app itself is downloaded during
installation.

## License

MIT
