import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { createTestSubprocessEnvironment } = require('./database-url-policy.cjs');

function discover(directory, unitOnly = false) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discover(path, unitOnly);
    if (!entry.isFile() || !(entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.cjs'))) return [];
    if (unitOnly && (
      path === 'apps/api/src/activity-import.integration.test.ts' ||
      path === 'apps/web/app/activity-import-proxy.integration.test.ts'
    )) return [];
    return [path];
  });
}

export function runTestSuite({
  unitOnly = false,
  environment = process.env,
  spawn = spawnSync,
} = {}) {
  const files = ['apps/api/src', 'apps/web/app', 'scripts'].flatMap(directory => discover(directory, unitOnly)).sort();
  if (files.length === 0) throw new Error('No tests discovered.');

  const childEnvironment = unitOnly ? environment : createTestSubprocessEnvironment(environment);
  if (!unitOnly) {
    const generated = spawn('npm', ['run', 'db:generate'], {
      stdio: 'inherit',
      env: childEnvironment,
    });
    if (generated.error) throw generated.error;
    if (generated.status !== 0) return generated.status ?? 1;
  }

  const result = spawn(process.execPath, [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    ...files,
  ], { stdio: 'inherit', env: childEnvironment });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runTestSuite({ unitOnly: process.argv.includes('--unit') });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test database configuration is invalid.';
    console.error(message);
    process.exitCode = 1;
  }
}
