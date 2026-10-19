import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(root, 'package.json');
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));

const [major, minor, patch] = manifest.version.split('.').map(Number);
manifest.version = `${major}.${minor}.${patch + 1}`;

writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(root, 'src', 'app', 'version.ts'),
  `export const APP_VERSION = '${manifest.version}';\n`,
);
console.log(`version bumped: ${manifest.version}`);
