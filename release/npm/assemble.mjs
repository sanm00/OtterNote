#!/usr/bin/env node
// Assembles the publishable npm package for `otter-note`.
//
// The package is intentionally not tracked in the repository: it is generated
// from the package sources in `release/npm/package/` (bin/, lib/, README.md)
// plus the installer in `release/install/install.sh` right before `npm pack` /
// `npm publish`, so the version comes from tauri.conf.json and the installer
// logic never exists twice. `release/npm/publish.sh` runs this, and
// `release/npm/verify.mjs` runs it into a throwaway directory to gate the
// generated contents.
//
// Usage: node release/npm/assemble.mjs [output-dir]
//   output-dir defaults to `.npm-pkg` below the repository root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cliDir = fileURLToPath(new URL('./package/', import.meta.url));
const outDir = path.resolve(process.argv[2] ?? path.join(root, '.npm-pkg'));

const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = tauriConfig.version;

const copied = [
  { from: path.join(cliDir, 'bin/otter-note.js'), to: path.join(outDir, 'bin/otter-note.js'), mode: 0o755 },
  { from: path.join(cliDir, 'lib/platform.js'), to: path.join(outDir, 'lib/platform.js'), mode: 0o644 },
  {
    from: path.join(root, 'release/install/install.sh'),
    to: path.join(outDir, 'scripts/install.sh'),
    mode: 0o755,
  },
  { from: path.join(cliDir, 'README.md'), to: path.join(outDir, 'README.md'), mode: 0o644 },
  { from: path.join(root, 'LICENSE'), to: path.join(outDir, 'LICENSE'), mode: 0o644 },
];

fs.rmSync(outDir, { recursive: true, force: true });
for (const file of copied) {
  fs.mkdirSync(path.dirname(file.to), { recursive: true });
  fs.copyFileSync(file.from, file.to);
  fs.chmodSync(file.to, file.mode);
}

const packageJson = {
  name: 'otter-note',
  version,
  description: 'Installer and launcher for the OtterNote desktop app (macOS and Linux)',
  license: 'MIT',
  type: 'module',
  repository: {
    type: 'git',
    url: 'git+https://github.com/sanm00/OtterNote.git',
  },
  homepage: 'https://github.com/sanm00/OtterNote',
  bugs: {
    url: 'https://github.com/sanm00/OtterNote/issues',
  },
  bin: {
    'otter-note': 'bin/otter-note.js',
  },
  files: ['bin', 'lib', 'scripts/install.sh', 'README.md'],
  os: ['darwin', 'linux'],
  cpu: ['x64', 'arm64'],
  engines: {
    node: '>=18',
  },
  keywords: ['otternote', 'notes', 'todo', 'markdown', 'tauri', 'desktop'],
  scripts: {
    postinstall: 'node bin/otter-note.js postinstall',
  },
};

fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`Assembled otter-note@${version} at ${path.relative(root, outDir)}`);
