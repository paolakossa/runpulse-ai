import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function requireLocalDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('DATABASE_URL must be configured.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid local PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('DATABASE_URL must target a loopback PostgreSQL server.');
  }
  return value;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
    super({
      adapter: new PrismaPg({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 2_000,
        idleTimeoutMillis: 10_000,
        statement_timeout: 5_000,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
