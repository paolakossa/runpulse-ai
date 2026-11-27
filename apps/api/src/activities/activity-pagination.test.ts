import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseActivityPagination } from './activity-pagination.ts';

test('uses bounded defaults and accepts strict positive decimal parameters', () => {
  assert.deepEqual(parseActivityPagination(undefined, undefined), { page: 1, pageSize: 20 });
  assert.deepEqual(parseActivityPagination('3', '50'), { page: 3, pageSize: 50 });
  assert.deepEqual(parseActivityPagination('10000', '100'), { page: 10000, pageSize: 100 });
});

test('rejects malformed, repeated, zero, negative, and out-of-range pagination values', () => {
  for (const [page, pageSize] of [
    ['0', '20'],
    ['01', '20'],
    ['-1', '20'],
    ['1.5', '20'],
    ['Infinity', '20'],
    ['10001', '20'],
    [undefined, '0'],
    [undefined, '101'],
    [undefined, '20.0'],
    [['1', '2'], '20'],
  ] as const) {
    assert.throws(() => parseActivityPagination(page, pageSize), (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error &&
      error.code === 'INVALID_PAGINATION');
  }
});
