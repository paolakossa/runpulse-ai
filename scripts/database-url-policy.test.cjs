const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const {
  configureTestDatabaseProcess,
  createTestSubprocessEnvironment,
  resolvePrismaDatasourceUrl,
  validateMigrationDatabaseUrl,
  validateTestDatabaseConfiguration,
} = require('./database-url-policy.cjs');

const developmentUrl = 'postgresql://runpulse:development-secret@127.0.0.1:5433/runpulse?schema=public';
const testUrl = 'postgresql://runpulse_test:isolated-secret@127.0.0.1:5434/runpulse_test?schema=public';

function localEnvironment(overrides = {}) {
  return {
    DATABASE_URL: developmentUrl,
    RUNPULSE_TEST_DATABASE_URL: testUrl,
    POSTGRES_PASSWORD: 'development-secret',
    POSTGRES_TEST_PASSWORD: 'isolated-secret',
    ...overrides,
  };
}

test('requires an explicit test URL and rejects malformed or remote destinations', () => {
  assert.throws(() => validateTestDatabaseConfiguration({ DATABASE_URL: developmentUrl }), /RUNPULSE_TEST_DATABASE_URL/);
  for (const invalidUrl of [
    'not a URL',
    'https://127.0.0.1:5434/runpulse_test',
    'postgresql://runpulse_test:isolated-secret@example.com:5434/runpulse_test',
  ]) {
    assert.throws(
      () => validateTestDatabaseConfiguration(localEnvironment({ RUNPULSE_TEST_DATABASE_URL: invalidUrl })),
      /dedicated local test database/,
    );
  }
});

test('rejects a development URL, port, database name, user, or password as test configuration', () => {
  const invalidUrls = [
    developmentUrl,
    'postgresql://runpulse_test:isolated-secret@127.0.0.1:5433/runpulse_test',
    'postgresql://runpulse_test:isolated-secret@127.0.0.1:5434/runpulse',
    'postgresql://runpulse:isolated-secret@127.0.0.1:5434/runpulse_test',
    'postgresql://runpulse_test:development-secret@127.0.0.1:5434/runpulse_test',
  ];

  for (const invalidUrl of invalidUrls) {
    assert.throws(() => validateTestDatabaseConfiguration(
      localEnvironment({ RUNPULSE_TEST_DATABASE_URL: invalidUrl }),
    ), error => {
      assert.doesNotMatch(error.message, /development-secret|isolated-secret|postgresql:\/\//);
      return true;
    });
  }
});

test('accepts an isolated local Docker test database and applies it to the process', () => {
  const environment = localEnvironment();
  assert.equal(validateTestDatabaseConfiguration(environment), testUrl);
  configureTestDatabaseProcess(environment);
  assert.equal(environment.DATABASE_URL, testUrl);
});

test('accepts the isolated ephemeral CI PostgreSQL configuration', () => {
  const ciUrl = 'postgresql://runpulse_test@127.0.0.1:5432/runpulse_test?schema=public';
  assert.equal(validateTestDatabaseConfiguration({
    CI: 'true',
    DATABASE_URL: ciUrl,
    RUNPULSE_TEST_DATABASE_URL: ciUrl,
  }), ciUrl);
});

test('propagates the validated test URL without mutating the parent environment', () => {
  const environment = localEnvironment();
  const childEnvironment = createTestSubprocessEnvironment(environment);

  assert.equal(childEnvironment.DATABASE_URL, testUrl);
  assert.equal(childEnvironment.RUNPULSE_TEST_DATABASE_URL, testUrl);
  assert.equal(childEnvironment.POSTGRES_PASSWORD, undefined);
  assert.equal(environment.POSTGRES_PASSWORD, 'development-secret');
  assert.equal(environment.DATABASE_URL, developmentUrl);
});

test('passes the validated test URL to generation and every test subprocess', async () => {
  const { runTestSuite } = await import('./test.mjs');
  const environment = localEnvironment();
  const calls = [];
  const exitCode = runTestSuite({
    environment,
    spawn: (command, args, options) => {
      calls.push({ command, args, environment: options.env });
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.environment.DATABASE_URL, testUrl);
    assert.equal(call.environment.RUNPULSE_TEST_DATABASE_URL, testUrl);
    assert.equal(call.environment.POSTGRES_PASSWORD, undefined);
  }
  assert.equal(environment.DATABASE_URL, developmentUrl);
});

test('rejects unsafe configuration before the test runner can initialize Prisma or Nest', async () => {
  const { runTestSuite } = await import('./test.mjs');
  let spawnCount = 0;
  assert.throws(() => runTestSuite({
    files: ['apps/api/src/activity-import.integration.test.ts'],
    environment: { DATABASE_URL: developmentUrl },
    spawn: () => {
      spawnCount++;
      return { status: 0 };
    },
  }), /RUNPULSE_TEST_DATABASE_URL/);
  assert.equal(spawnCount, 0);
});

test('direct API and web integration test invocation fails closed before database access', () => {
  for (const relativePath of [
    'apps/api/src/activity-import.integration.test.ts',
    'apps/web/app/activity-import-proxy.integration.test.ts',
  ]) {
    const environment = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATABASE_URL: developmentUrl,
      CI: 'false',
    };
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--test',
      relativePath,
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: environment,
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /RUNPULSE_TEST_DATABASE_URL/);
    assert.doesNotMatch(output, /development-secret|isolated-secret|P1000|ECONNREFUSED/);
  }
});

test('permits only authorized local and ephemeral-CI Prisma migration targets', () => {
  assert.equal(validateMigrationDatabaseUrl(developmentUrl, localEnvironment()), developmentUrl);
  assert.equal(validateMigrationDatabaseUrl(testUrl, localEnvironment()), testUrl);
  const ciUrl = 'postgresql://runpulse_test@127.0.0.1:5432/runpulse_test?schema=public';
  assert.equal(validateMigrationDatabaseUrl(ciUrl, {
    CI: 'true',
    DATABASE_URL: ciUrl,
    RUNPULSE_TEST_DATABASE_URL: ciUrl,
  }), ciUrl);

  for (const invalidUrl of [
    'postgresql://runpulse:secret@example.com:5433/runpulse',
    'postgresql://runpulse:secret@127.0.0.1:5432/runpulse',
    'postgresql://runpulse_test:isolated-secret@127.0.0.1:5433/runpulse_test',
  ]) {
    assert.throws(() => validateMigrationDatabaseUrl(invalidUrl, localEnvironment()));
  }
});

test('keeps generation connection-free and rejects unapproved Prisma commands', () => {
  assert.equal(resolvePrismaDatasourceUrl(['generate'], {}), undefined);
  assert.equal(resolvePrismaDatasourceUrl(['migrate', 'status'], localEnvironment()), developmentUrl);
  assert.throws(() => resolvePrismaDatasourceUrl(['migrate', 'reset'], localEnvironment()), /not permitted/);
  assert.throws(() => resolvePrismaDatasourceUrl(['db', 'push'], localEnvironment()), /not permitted/);
  assert.throws(
    () => resolvePrismaDatasourceUrl(['migrate', 'deploy', '--config', '/tmp/other-config.ts'], localEnvironment()),
    /Custom Prisma config paths/,
  );
});

test('migration wrapper rejects CLI overrides and forwards only a validated target', async () => {
  const { runPrismaMigration } = await import('./prisma-migrate.mjs');
  let spawnOptions;
  const spawn = (_command, _args, options) => {
    spawnOptions = options;
    return { status: 0 };
  };
  const environment = localEnvironment();

  assert.equal(runPrismaMigration(['deploy'], environment, spawn), 0);
  assert.equal(spawnOptions.env.DATABASE_URL, developmentUrl);
  assert.equal(spawnOptions.env.RUNPULSE_TEST_DATABASE_URL, testUrl);

  assert.throws(
    () => runPrismaMigration(['deploy', '--config', '/tmp/other-config.ts'], environment, spawn),
    /without extra CLI options/,
  );
});
