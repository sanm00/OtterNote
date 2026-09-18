// The npm package is a thin wrapper around the installer that ships in this
// repository, so both install channels run exactly the same, already tested
// code. This copies scripts/install.sh and the project LICENSE into the package
// right before packing, so there is only one copy of each in the repository.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bundled = [
  { from: '../../../scripts/install.sh', to: '../scripts/install.sh', mode: 0o755 },
  { from: '../../../LICENSE', to: '../LICENSE', mode: 0o644 },
];

for (const file of bundled) {
  const source = fileURLToPath(new URL(file.from, import.meta.url));
  const destination = fileURLToPath(new URL(file.to, import.meta.url));

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, file.mode);

  console.log(
    `Bundled ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), destination)}`,
  );
}
