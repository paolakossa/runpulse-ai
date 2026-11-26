import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = discover('apps/api/src').sort();
if (files.length === 0) throw new Error('No API tests discovered.');
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
