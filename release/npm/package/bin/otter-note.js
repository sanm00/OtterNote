#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultInstallDir, tauriTarget, unsupportedMessage } from '../lib/platform.js';

const APP_NAME = 'OtterNote';
const INSTALL_SCRIPT = fileURLToPath(new URL('../scripts/install.sh', import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function usage() {
  console.log(`OtterNote ${packageJson.version}

Usage: otter-note [command] [options]

Commands:
  install      Install the desktop app (this ran during "npm install -g otter-note")
  uninstall    Remove the desktop app
  launch       Start the installed app (default command)
  help         Show this help

Options:
  -v, --version   Print the version of this CLI
  -h, --help      Show this help

Install options are passed through to the installer:
  --version VERSION    Release to install (default: latest)
  --install-dir DIR    Target directory (default: /Applications, ~/.local/bin on Linux)
  --dry-run            Show what would happen

Environment:
  OTTERNOTE_VERSION, OTTERNOTE_INSTALL_DIR, OTTERNOTE_BASE_URL
  Set OTTERNOTE_SKIP_INSTALL=1 to skip the download during npm install.

The installer never calls sudo and never touches your notes in ~/OtterNote.`);
}

function target() {
  return tauriTarget(process.platform, process.arch);
}

function resolveInstallDir(env) {
  return env.OTTERNOTE_INSTALL_DIR || env.INSTALL_DIR || defaultInstallDir(target(), env);
}

function scriptEnv(env) {
  const merged = { ...env };
  if (env.OTTERNOTE_VERSION) merged.VERSION = env.OTTERNOTE_VERSION;
  if (env.OTTERNOTE_INSTALL_DIR) merged.INSTALL_DIR = env.OTTERNOTE_INSTALL_DIR;
  if (env.OTTERNOTE_BASE_URL) merged.BASE_URL = env.OTTERNOTE_BASE_URL;
  return merged;
}

function runInstaller(args, env, { assumeYes = false } = {}) {
  if (!fs.existsSync(INSTALL_SCRIPT)) {
    console.error('error: the bundled installer is missing from this package.');
    return 1;
  }

  const installerEnv = scriptEnv(env);
  // Unattended installs (npm postinstall) must not wait for a prompt, but an
  // explicit "otter-note uninstall" should still ask before deleting the app.
  if (assumeYes && !installerEnv.YES) {
    installerEnv.YES = '1';
  }

  const result = spawnSync('sh', [INSTALL_SCRIPT, ...args], {
    stdio: 'inherit',
    env: installerEnv,
  });

  if (result.error) {
    console.error(`error: could not run the installer: ${result.error.message}`);
    return 1;
  }

  return result.status === null ? 1 : result.status;
}

function installedAppPath(env) {
  const targetInfo = target();
  if (!targetInfo) return null;

  const installDir = resolveInstallDir(env);
  if (!installDir) return null;

  return targetInfo.os === 'macos'
    ? path.join(installDir, `${APP_NAME}.app`)
    : path.join(installDir, 'otter-note');
}

function launch(env) {
  const appPath = installedAppPath(env);
  if (!appPath) {
    console.error(unsupportedMessage(process.platform, process.arch));
    return 1;
  }

  if (!fs.existsSync(appPath)) {
    console.error(`${APP_NAME} is not installed at ${appPath}.`);
    console.error('Run "otter-note install" to install it.');
    return 1;
  }

  const child =
    process.platform === 'darwin'
      ? spawn('open', [appPath], { detached: true, stdio: 'ignore' })
      : spawn(appPath, [], { detached: true, stdio: 'ignore' });

  // Wait for the child to actually start before this process may exit, then
  // detach it so the app does not keep the CLI alive. Exiting straight after
  // spawn() can drop the launch.
  child.once('spawn', () => child.unref());
  return 0;
}

function main(argv, env) {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case 'launch':
      return launch(env);

    case 'install':
      if (!target()) {
        console.error(unsupportedMessage(process.platform, process.arch));
        return 1;
      }
      return runInstaller(rest, env, { assumeYes: true });

    case 'postinstall':
      if (env.OTTERNOTE_SKIP_INSTALL === '1') {
        console.log('Skipping the OtterNote download because OTTERNOTE_SKIP_INSTALL=1.');
        console.log('Run "otter-note install" when you want to install it.');
        return 0;
      }
      if (!target()) {
        // Never fail an npm install on an unsupported machine.
        console.warn(unsupportedMessage(process.platform, process.arch));
        return 0;
      }
      return runInstaller(rest, env, { assumeYes: true });

    case 'uninstall':
      if (!target()) {
        console.error(unsupportedMessage(process.platform, process.arch));
        return 1;
      }
      return runInstaller(['--uninstall', ...rest], env);

    case 'help':
    case '--help':
    case '-h':
      usage();
      return 0;

    case '--version':
    case '-v':
      console.log(packageJson.version);
      return 0;

    default:
      console.error(`Unknown command: ${command}\n`);
      usage();
      return 1;
  }
}

// Set the code instead of calling process.exit() so a pending launch can
// finish before the event loop drains.
process.exitCode = main(process.argv.slice(2), process.env);
