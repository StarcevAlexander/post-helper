import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

if (existsSync(join(repoRoot, '.git')) && existsSync(join(repoRoot, '.githooks'))) {
  try {
    execFileSync('git', ['-C', repoRoot, 'config', 'core.hooksPath', '.githooks']);
    console.log('git hooks enabled: .githooks');
  } catch {
    console.log('git hooks not enabled: git is unavailable');
  }
}
