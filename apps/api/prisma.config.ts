import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createRequire } from 'node:module';
import { defineConfig } from 'prisma/config';

config({ path: resolve(__dirname, '../../.env'), override: false });
const require = createRequire(import.meta.url);
const { resolvePrismaDatasourceUrl } = require('../../scripts/database-url-policy.cjs') as {
  resolvePrismaDatasourceUrl(args: string[], environment: NodeJS.ProcessEnv): string | undefined;
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolvePrismaDatasourceUrl(process.argv.slice(2), process.env),
  },
});
