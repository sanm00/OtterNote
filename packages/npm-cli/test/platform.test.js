// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assetCandidates, defaultInstallDir, tauriTarget, unsupportedMessage } from '../lib/platform.js';

describe('tauriTarget', () => {
  it('maps macOS architectures to the names used in release assets', () => {
    expect(tauriTarget('darwin', 'arm64')).toEqual({ os: 'macos', arch: 'aarch64' });
    expect(tauriTarget('darwin', 'x64')).toEqual({ os: 'macos', arch: 'x64' });
  });

  it('maps Linux architectures to the names used in release assets', () => {
    expect(tauriTarget('linux', 'x64')).toEqual({ os: 'linux', arch: 'amd64' });
    expect(tauriTarget('linux', 'arm64')).toEqual({ os: 'linux', arch: 'aarch64' });
  });

  it('rejects platforms that OtterNote does not support', () => {
    expect(tauriTarget('win32', 'x64')).toBeNull();
    expect(tauriTarget('linux', 'ia32')).toBeNull();
    expect(tauriTarget('darwin', 'ppc64')).toBeNull();
  });
});

describe('assetCandidates', () => {
  it('tries the architecture specific dmg first on macOS', () => {
    const candidates = assetCandidates(tauriTarget('darwin', 'arm64'), '0.1.0');
    expect(candidates[0]).toBe('OtterNote_0.1.0_aarch64.dmg');
    expect(candidates).toContain('OtterNote_0.1.0_universal.dmg');
  });

  it('tries the architecture specific AppImage first on Linux', () => {
    const candidates = assetCandidates(tauriTarget('linux', 'x64'), '0.1.0');
    expect(candidates[0]).toBe('otter-note_0.1.0_amd64.AppImage');
  });

  it('returns nothing without a supported target', () => {
    expect(assetCandidates(null, '0.1.0')).toEqual([]);
  });
});

describe('defaultInstallDir', () => {
  it('uses the system Applications folder on macOS', () => {
    expect(defaultInstallDir(tauriTarget('darwin', 'arm64'), {})).toBe('/Applications');
  });

  it('uses XDG_BIN_HOME on Linux when it is set', () => {
    expect(defaultInstallDir(tauriTarget('linux', 'x64'), { XDG_BIN_HOME: '/opt/bin' })).toBe('/opt/bin');
  });

  it('falls back to ~/.local/bin on Linux', () => {
    expect(defaultInstallDir(tauriTarget('linux', 'x64'), { HOME: '/home/otter' })).toBe(
      '/home/otter/.local/bin',
    );
  });

  it('has no default without a supported target', () => {
    expect(defaultInstallDir(null, {})).toBeNull();
  });
});

describe('unsupportedMessage', () => {
  it('names the supported platforms and points at the releases page', () => {
    const message = unsupportedMessage('win32', 'x64');
    expect(message).toContain('macOS and Linux');
    expect(message).toContain('win32/x64');
    expect(message).toContain('releases');
  });
});
