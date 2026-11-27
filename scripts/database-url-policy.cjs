const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const TEST_DATABASE_NAME = 'runpulse_test';
const TEST_DATABASE_USER = 'runpulse_test';

function invalidDatabaseUrl() {
  return new Error('Database URL must target the dedicated local test database or an authorized local RunPulse database.');
}

function parseDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) throw invalidDatabaseUrl();

  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalidDatabaseUrl();
  }

  if (url.protocol !== 'postgresql:' ||
      !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
      url.searchParams.size > 1 ||
      (url.searchParams.size === 1 && url.searchParams.get('schema') !== 'public') ||
      url.hash) {
    throw invalidDatabaseUrl();
  }

  let username;
  let password;
  let database;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw invalidDatabaseUrl();
  }

  return {
    url,
    username,
    password,
    database,
    host: url.hostname.toLowerCase(),
    port: url.port,
  };
}

function isSameDatabase(left, right) {
  return left.host === right.host &&
    left.port === right.port &&
    left.database === right.database &&
    left.username === right.username;
}

function validateTestDatabaseConfiguration(environment) {
  const configuredUrl = environment.RUNPULSE_TEST_DATABASE_URL;
  if (!configuredUrl) {
    throw new Error('RUNPULSE_TEST_DATABASE_URL is required; tests never fall back to DATABASE_URL.');
  }

  const test = parseDatabaseUrl(configuredUrl);
  const isCi = environment.CI === 'true';
  const expectedPort = isCi ? '5432' : '5434';
  if (test.port !== expectedPort ||
      test.database !== TEST_DATABASE_NAME ||
      test.username !== TEST_DATABASE_USER) {
    throw new Error('RUNPULSE_TEST_DATABASE_URL must target the dedicated local test database, user, and port.');
  }

  if (environment.POSTGRES_TEST_PASSWORD &&
      test.password !== environment.POSTGRES_TEST_PASSWORD) {
    throw new Error('RUNPULSE_TEST_DATABASE_URL credentials must match the configured test database credentials.');
  }

  if (environment.DATABASE_URL) {
    const development = parseDatabaseUrl(environment.DATABASE_URL);
    if (environment.DATABASE_URL !== configuredUrl &&
        (isSameDatabase(test, development) ||
          (development.password && test.password === development.password))) {
      throw new Error('The test database must be separate from the configured development database and credentials.');
    }
  }

  if (environment.POSTGRES_PASSWORD &&
      test.password === environment.POSTGRES_PASSWORD) {
    throw new Error('The test database credentials must be separate from development credentials.');
  }

  return configuredUrl;
}

function configureTestDatabaseProcess(environment) {
  const testUrl = validateTestDatabaseConfiguration(environment);
  environment.DATABASE_URL = testUrl;
  return testUrl;
}

function createTestSubprocessEnvironment(environment) {
  const testUrl = validateTestDatabaseConfiguration(environment);
  const childEnvironment = { ...environment, DATABASE_URL: testUrl, RUNPULSE_TEST_DATABASE_URL: testUrl };
  delete childEnvironment.POSTGRES_PASSWORD;
  return childEnvironment;
}

function validateMigrationDatabaseUrl(value, environment) {
  const target = parseDatabaseUrl(value);
  const isCi = environment.CI === 'true';

  if (isCi) {
    if (target.port !== '5432' ||
        target.database !== TEST_DATABASE_NAME ||
        target.username !== TEST_DATABASE_USER) {
      throw invalidDatabaseUrl();
    }
    if (environment.RUNPULSE_TEST_DATABASE_URL !== value) {
      throw new Error('CI migrations require the explicit ephemeral RUNPULSE_TEST_DATABASE_URL.');
    }
    validateTestDatabaseConfiguration({ ...environment, DATABASE_URL: value });
    return value;
  }

  const isDevelopment = target.port === '5433' &&
    target.database === 'runpulse' &&
    target.username === 'runpulse';
  const isTest = target.port === '5434' &&
    target.database === TEST_DATABASE_NAME &&
    target.username === TEST_DATABASE_USER;

  if (isDevelopment) {
    if (environment.POSTGRES_PASSWORD && target.password !== environment.POSTGRES_PASSWORD) {
      throw new Error('Development migrations require the configured local development database credentials.');
    }
    return value;
  }

  if (isTest) {
    if (environment.RUNPULSE_TEST_DATABASE_URL !== value) {
      throw new Error('Test migrations require the explicit isolated RUNPULSE_TEST_DATABASE_URL.');
    }
    validateTestDatabaseConfiguration({ ...environment, DATABASE_URL: value });
    return value;
  }

  throw invalidDatabaseUrl();
}

function resolvePrismaDatasourceUrl(args, environment) {
  if (args.includes('--config') || args.includes('-c')) {
    throw new Error('Custom Prisma config paths are not permitted for database commands.');
  }
  if (args[0] === 'generate') return undefined;
  if (args[0] !== 'migrate' || !['deploy', 'status'].includes(args[1])) {
    throw new Error('This Prisma command is not permitted; use client generation or an approved migration command.');
  }

  return validateMigrationDatabaseUrl(environment.DATABASE_URL, environment);
}

module.exports = {
  configureTestDatabaseProcess,
  createTestSubprocessEnvironment,
  resolvePrismaDatasourceUrl,
  validateMigrationDatabaseUrl,
  validateTestDatabaseConfiguration,
};
