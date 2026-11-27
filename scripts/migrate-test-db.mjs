import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateTestDatabaseConfiguration } = require('./database-url-policy.cjs');
const value = validateTestDatabaseConfiguration(process.env);

const result = spawnSync('npm', ['run', 'migrate:deploy', '-w', '@runpulse/api'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: value, RUNPULSE_TEST_DATABASE_URL: value },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
