import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseActivityFingerprintSecret } from './activity-fingerprint.ts';

test('requires a 32-byte hexadecimal fingerprint secret', () => {
  const parsed = parseActivityFingerprintSecret('ab'.repeat(32));

  assert.equal(parsed.byteLength, 32);
  assert.deepEqual(parsed, Buffer.alloc(32, 0xab));
});

test('rejects missing or malformed secrets without echoing the configured value', () => {
  for (const value of [undefined, '', 'secret-value', 'ab'.repeat(31), 'zz'.repeat(32)]) {
    assert.throws(
      () => parseActivityFingerprintSecret(value),
      error => error instanceof Error &&
        error.message.includes('ACTIVITY_FINGERPRINT_SECRET') &&
        (!value || !error.message.includes(value)),
    );
  }
});
