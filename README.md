# OtterNote

Local-first notes and ToDo app with a two-column workspace.

## Stack

- Tauri
- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- CodeMirror 6
- Rust for desktop file system access

## Features

- Two-column workspace with sidebar navigation and content area
- Notes list, note detail, timeline, ToDo list, images, settings, and help
- Markdown editing and preview
- Inline ToDo parsing from note content
- Notes grouped by time in timeline view
- Image upload through file picker or paste
- Separate preview and original image storage on desktop
- Note export to markdown
- Global search for notes and ToDo content
- Light and dark theme support
- Keyboard shortcuts with custom configuration

## Storage

The app is local-first.

- Desktop app default storage root: `~/OtterNote`
- Root data file: `state.json`
- Notes: `notes/*.json`
- Images: `images/*`
- Search index: `search-index.json`

You can change the storage folder in Settings on the desktop app.

## Development

Install dependencies:

```sh
npm install
```

Run the web app:

```sh
npm run dev
```

Run the Tauri desktop app:

```sh
npm run tauri -- dev
```

Build frontend:

```sh
npm run build
```

Build Tauri app:

```sh
npm run tauri -- build --debug
```

Run tests:

```sh
npm test
```

## Production Build

To build a distributable desktop app:

```sh
npm run tauri -- build
```

This runs the frontend build first, then packages the Tauri desktop application for the current platform. On macOS, the output is written under `src-tauri/target/release/bundle/`.

If you only need a debug bundle for local validation:

```sh
npm run tauri -- build --debug
```

## Notes

- Web preview uses browser storage.
- Desktop app uses the local folder storage above.
- Images are stored separately from note content to keep notes smaller and faster to open.
