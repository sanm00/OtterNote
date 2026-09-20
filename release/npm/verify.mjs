// Consistency gate for the published npm package.
//
// The npm package is generated from the repository by
// release/npm/assemble.mjs, so its version, supported platforms and asset
// names all come from the project itself. A few facts appear in more than one
// place regardless -- the GitHub slug, the asset names and the default install
// directories -- and every one of them is asserted here instead of being kept
// in sync by memory.
//
// Run it directly (`node release/npm/verify.mjs`), through CI, or let
// `release/npm/publish.sh` run it before it packs or publishes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { assetCandidates, defaultInstallDir, tauriTarget } from './package/lib/platform.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliDir = path.join(repoRoot, 'release/npm/package');

// The published package is generated (release/npm/assemble.mjs), not tracked
// in the repository. Assemble it into a throwaway directory so the gate checks
// the exact package contents that `npm pack` would produce.
const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-note-check-'));
const assemble = spawnSync(process.execPath, [path.join(repoRoot, 'release/npm/assemble.mjs'), packageRoot], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (assemble.status !== 0) {
  console.error(assemble.stdout || assemble.stderr || 'assemble.mjs failed');
  process.exit(1);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rootPackage = readJson(path.join(repoRoot, 'package.json'));
const cliPackage = readJson(path.join(packageRoot, 'package.json'));
const tauriConfig = readJson(path.join(repoRoot, 'src-tauri/tauri.conf.json'));
const installer = fs.readFileSync(path.join(repoRoot, 'release/install/install.sh'), 'utf8');
const platformSource = fs.readFileSync(path.join(cliDir, 'lib/platform.js'), 'utf8');
const npmReleaseScript = fs.readFileSync(path.join(repoRoot, 'release/npm/publish.sh'), 'utf8');

// A version nobody would ever release, so the asset names can be compared
// between the two channels without depending on the current release.
const SENTINEL = '0.0.0-consistency-check';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
};

const slugFromUrl = (url) => url?.match(/github\.com[:/]([\w.-]+\/[\w.-]+)/)?.[1]?.replace(/\.git$/, '');

// The installer keeps its asset names in a shell function; read them back so
// the two channels can be compared literally.
const shellCandidatesFor = (os) => {
  const body = installer.match(/asset_candidates\(\)\s*\{([\s\S]*?)\n\}/)?.[1];
  const branch = body?.match(new RegExp(`\\b${os}\\)\\n([\\s\\S]*?);;`))?.[1];
  return [...(branch ?? '').matchAll(/"([^"]*)"/g)].map((match) => match[1]);
};

const expandShellName = (name, arch) => name.replaceAll('${VERSION}', SENTINEL).replaceAll('${ARCH}', arch);

const targetArchitectures = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'x64'],
  ['linux', 'arm64'],
];

// --- versions ---------------------------------------------------------------

const versions = {
  'package.json': rootPackage.version,
  'src-tauri/tauri.conf.json': tauriConfig.version,
  'generated npm package.json': cliPackage.version,
};
const distinctVersions = [...new Set(Object.values(versions))];
check(
  'one version across the repository',
  distinctVersions.length === 1,
  `found ${distinctVersions.join(' vs ')} (${Object.entries(versions)
    .map(([file, version]) => `${file}=${version}`)
    .join(', ')})`,
);

check(
  'the root package stays private so it cannot be published by accident',
  rootPackage.private === true,
  `private: ${JSON.stringify(rootPackage.private)}`,
);

// --- repository slug --------------------------------------------------------

const slugs = {
  'release/install/install.sh': installer.match(/^REPO="([^"]+)"/m)?.[1],
  'lib/platform.js': slugFromUrl(platformSource.match(/https:\/\/github\.com\/[\w./-]+/)?.[0]),
  'package.json repository': slugFromUrl(cliPackage.repository?.url),
  'package.json homepage': slugFromUrl(cliPackage.homepage),
  'package.json bugs': slugFromUrl(cliPackage.bugs?.url),
};
const distinctSlugs = [...new Set(Object.values(slugs))];
check(
  'the same GitHub repository everywhere',
  distinctSlugs.length === 1 && Boolean(distinctSlugs[0]),
  Object.entries(slugs)
    .map(([where, slug]) => `${where}=${slug ?? 'missing'}`)
    .join(', '),
);

// --- supported platforms ----------------------------------------------------

const declaredOs = [...(cliPackage.os ?? [])].sort();
const declaredCpu = [...(cliPackage.cpu ?? [])].sort();
check(
  'the package declares exactly the supported platforms',
  JSON.stringify(declaredOs) === JSON.stringify(['darwin', 'linux']) &&
    JSON.stringify(declaredCpu) === JSON.stringify(['arm64', 'x64']),
  `os=[${declaredOs}] cpu=[${declaredCpu}]`,
);

for (const [platform, arch] of targetArchitectures) {
  check(
    `${platform}/${arch} resolves to a Tauri target`,
    tauriTarget(platform, arch) !== null,
    'lib/platform.js returned null',
  );
}
check('Windows is still rejected', tauriTarget('win32', 'x64') === null, 'it resolved anyway');

// --- release asset names ----------------------------------------------------

for (const [platform, arch] of targetArchitectures) {
  const target = tauriTarget(platform, arch);
  if (!target) continue;

  const fromPackage = assetCandidates(target, SENTINEL);
  const fromInstaller = shellCandidatesFor(target.os).map((name) => expandShellName(name, target.arch));

  check(
    `asset names agree between lib/platform.js and scripts/install.sh for ${target.os}/${target.arch}`,
    fromPackage.length > 0 && JSON.stringify(fromPackage) === JSON.stringify(fromInstaller),
    `package=[${fromPackage.join(', ')}] installer=[${fromInstaller.join(', ')}]`,
  );
}

const expectedDmg = `${tauriConfig.productName}_${SENTINEL}_${tauriTarget('darwin', 'arm64').arch}.dmg`;
check(
  'the macOS image name follows tauri.conf productName',
  assetCandidates(tauriTarget('darwin', 'arm64'), SENTINEL)[0] === expectedDmg &&
    shellCandidatesFor('macos').map((name) => expandShellName(name, 'aarch64'))[0] === expectedDmg,
  `expected ${expectedDmg}`,
);

// --- default install directories -------------------------------------------

const macOSInstallDir = defaultInstallDir(tauriTarget('darwin', 'arm64'), {});
check(
  'both channels default macOS to /Applications',
  macOSInstallDir === '/Applications' && installer.includes("printf '/Applications'"),
  `lib/platform.js=${macOSInstallDir}`,
);

const xdgInstallDir = defaultInstallDir(tauriTarget('linux', 'x64'), {
  XDG_BIN_HOME: '/xdg-bin',
  HOME: '/home/user',
});
const fallbackInstallDir = defaultInstallDir(tauriTarget('linux', 'x64'), { HOME: '/home/user' });
check(
  'both channels honour XDG_BIN_HOME then fall back to ~/.local/bin',
  xdgInstallDir === '/xdg-bin' &&
    fallbackInstallDir === '/home/user/.local/bin' &&
    installer.includes('${XDG_BIN_HOME:-$HOME/.local/bin}'),
  `XDG=${xdgInstallDir} fallback=${fallbackInstallDir}`,
);

// --- package contents -------------------------------------------------------

const missingFiles = (cliPackage.files ?? [])
  .map((entry) => path.join(packageRoot, entry))
  .filter((entry) => !fs.existsSync(entry))
  .map((entry) => path.relative(packageRoot, entry));
check(
  'everything listed in "files" exists',
  (cliPackage.files ?? []).length > 0 && missingFiles.length === 0,
  missingFiles.length ? `missing: ${missingFiles.join(', ')}` : cliPackage.files.join(', '),
);

check(
  'the installer is shipped inside the package',
  (cliPackage.files ?? []).includes('scripts/install.sh'),
  'add "scripts/install.sh" to files and let the assembler copy it',
);

const binRelative = Object.values(cliPackage.bin ?? {})[0];
const binPath = binRelative ? path.join(packageRoot, binRelative) : null;
const binSource = binPath && fs.existsSync(binPath) ? fs.readFileSync(binPath, 'utf8') : '';
check(
  'the CLI entry point exists and is a Node executable',
  Boolean(binPath) && binSource.startsWith('#!/usr/bin/env node'),
  `bin: ${binRelative ?? 'missing'}`,
);

check(
  'the CLI stays dependency-free',
  Object.keys(cliPackage.dependencies ?? {}).length === 0 &&
    Object.keys(cliPackage.devDependencies ?? {}).length === 0,
  `dependencies: ${JSON.stringify(cliPackage.dependencies ?? {})} devDependencies: ${JSON.stringify(cliPackage.devDependencies ?? {})}`,
);

check(
  'publish.sh runs the consistency gate',
  npmReleaseScript.includes('node release/npm/verify.mjs'),
  'publish.sh is the only supported publish path and must run the gate first',
);

check(
  'publish.sh assembles the package before packing',
  npmReleaseScript.includes('release/npm/assemble.mjs'),
  'publish.sh must assemble the package before npm pack / npm publish',
);

check(
  'the package postinstall is wired',
  String(cliPackage.scripts?.postinstall ?? '').includes('postinstall'),
  `postinstall: ${cliPackage.scripts?.postinstall ?? 'missing'}`,
);

// --- report -----------------------------------------------------------------

const failed = results.filter((result) => !result.ok);

console.log('npm release consistency check');
for (const result of results) {
  const status = result.ok ? '  ok  ' : ' FAIL ';
  const suffix = result.ok ? '' : `\n         ${result.detail}`;
  console.log(`[${status}] ${result.name}${suffix}`);
}

if (failed.length > 0) {
  console.error(
    `\n${failed.length} of ${results.length} checks failed. Fix the duplicated fact (or update this script if a check is outdated) before publishing.`,
  );
  process.exitCode = 1;
} else {
  console.log(`\nAll ${results.length} checks passed.`);
}
