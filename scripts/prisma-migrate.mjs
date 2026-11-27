import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, '../apps/api');
const require = createRequire(import.meta.url);
const { validateMigrationDatabaseUrl } = require('./database-url-policy.cjs');

export function runPrismaMigration(
  args = process.argv.slice(2),
  environment = process.env,
  spawn = spawnSync,
) {
  const [migrationCommand, ...extraArgs] = args;
  if (!['deploy', 'status'].includes(migrationCommand) || extraArgs.length > 0) {
    throw new Error('Use only the guarded migrate deploy or migrate status commands without extra CLI options.');
  }

  const databaseUrl = validateMigrationDatabaseUrl(environment.DATABASE_URL, environment);
  const result = spawn('prisma', ['migrate', migrationCommand], {
    cwd: apiDirectory,
    env: { ...environment, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runPrismaMigration();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Prisma migration configuration is invalid.');
    process.exitCode = 1;
  }
}
