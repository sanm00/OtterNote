import path from 'node:path';

/** Platform and architecture names used in Tauri release asset names. */
export function tauriTarget(platform, arch) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return { os: 'macos', arch: 'aarch64' };
    if (arch === 'x64') return { os: 'macos', arch: 'x64' };
    return null;
  }

  if (platform === 'linux') {
    if (arch === 'x64') return { os: 'linux', arch: 'amd64' };
    if (arch === 'arm64') return { os: 'linux', arch: 'aarch64' };
    return null;
  }

  return null;
}

export function assetCandidates(target, version) {
  if (!target) return [];

  if (target.os === 'macos') {
    return [`OtterNote_${version}_${target.arch}.dmg`, `OtterNote_${version}_universal.dmg`];
  }

  return [
    `otter-note_${version}_${target.arch}.AppImage`,
    `otter-note_${version}_${target.arch}.appimage`,
    `OtterNote_${version}_${target.arch}.AppImage`,
    `OtterNote_${version}_${target.arch}.appimage`,
  ];
}

export function defaultInstallDir(target, env) {
  if (!target) return null;
  if (target.os === 'macos') return '/Applications';

  const xdgBinHome = env.XDG_BIN_HOME;
  if (xdgBinHome) return xdgBinHome;
  return path.join(env.HOME || '', '.local', 'bin');
}

export function unsupportedMessage(platform, arch) {
  return (
    `OtterNote supports macOS and Linux. ` +
    `This machine is ${platform}/${arch}, which is not supported.\n` +
    `Downloads for supported platforms: https://github.com/sanm00/OtterNote/releases`
  );
}
