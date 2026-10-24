import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

writeFileSync(join(root, 'src', 'app', 'version.ts'), `export const APP_VERSION = '${version}';\n`);
writeFileSync(join(root, 'public', 'version.json'), `${JSON.stringify({ version })}\n`);
console.log(`version.ts synced: ${version}`);
