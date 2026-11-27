import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '../generated/prisma/client.ts';
import { isDatabaseUnavailable, isFingerprintUniqueViolation } from './activity-database-errors.ts';

function knownRequestError(code: string, target?: string | string[]): Error {
  return new Prisma.PrismaClientKnownRequestError('database operation failed', {
    code,
    clientVersion: '7.10.1',
    meta: target === undefined ? undefined : { target },
  });
}

test('classifies only the fingerprint unique constraint as a duplicate', () => {
  assert.equal(isFingerprintUniqueViolation(knownRequestError('P2002', ['fingerprint'])), true);
  assert.equal(isFingerprintUniqueViolation(knownRequestError('P2002', 'activities_fingerprint_key')), true);
  assert.equal(isFingerprintUniqueViolation(knownRequestError('P2002', ['id'])), false);
  assert.equal(isFingerprintUniqueViolation(knownRequestError('P2002', ['segment_count'])), false);
  assert.equal(isFingerprintUniqueViolation(knownRequestError('P2004', ['fingerprint'])), false);
  assert.equal(isFingerprintUniqueViolation(new Error('database operation failed')), false);
  assert.equal(isFingerprintUniqueViolation(new Prisma.PrismaClientKnownRequestError('database operation failed', {
    code: 'P2002',
    clientVersion: '7.10.1',
    meta: {
      driverAdapterError: {
        cause: {
          constraint: { index: 'activities_fingerprint_key' },
        },
      },
    },
  })), true);
  assert.equal(isFingerprintUniqueViolation(new Prisma.PrismaClientKnownRequestError('database operation failed', {
    code: 'P2002',
    clientVersion: '7.10.1',
    meta: {
      driverAdapterError: {
        cause: {
          constraint: { index: 'activities_segment_count_positive_check' },
        },
      },
    },
  })), false);
});

test('classifies transient connection errors without exposing their details', () => {
  const initialization = new Prisma.PrismaClientInitializationError('secret connection information', '7.10.1');
  assert.equal(isDatabaseUnavailable(initialization), true);
  for (const code of ['P1001', 'P1002', 'P1008', 'P1017', 'P2024']) {
    assert.equal(isDatabaseUnavailable(knownRequestError(code)), true);
  }
  assert.equal(isDatabaseUnavailable(knownRequestError('P2002', ['fingerprint'])), false);
  assert.equal(isDatabaseUnavailable(new Error('unrelated internal failure')), false);
});
