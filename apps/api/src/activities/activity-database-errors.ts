import { Prisma } from '../generated/prisma/client.ts';

const DATABASE_CONNECTION_ERROR_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFingerprintUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (target === 'fingerprint' || target === 'activities_fingerprint_key') return true;
  if (Array.isArray(target) && target.length === 1 && target[0] === 'fingerprint') return true;

  const adapterError = error.meta?.driverAdapterError;
  if (!isRecord(adapterError) || !isRecord(adapterError.cause) || !isRecord(adapterError.cause.constraint)) {
    return false;
  }
  const constraint = adapterError.cause.constraint;
  return constraint.index === 'activities_fingerprint_key' ||
    (Array.isArray(constraint.fields) && constraint.fields.length === 1 && constraint.fields[0] === 'fingerprint');
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    DATABASE_CONNECTION_ERROR_CODES.has(error.code);
}
