import { createHmac } from 'node:crypto';
import type { Activity } from '../activity.ts';

const FINGERPRINT_VERSION = 'v1';
const FINGERPRINT_PREFIX = 'runpulse-activity-fingerprint:v1\0';
export const ACTIVITY_FINGERPRINT_SECRET = Symbol('ACTIVITY_FINGERPRINT_SECRET');

export function parseActivityFingerprintSecret(value: string | undefined): Buffer {
  if (!value || !/^[a-f\d]{64}$/i.test(value)) {
    throw new Error('ACTIVITY_FINGERPRINT_SECRET must be 32 random bytes encoded as 64 hexadecimal characters.');
  }
  return Buffer.from(value, 'hex');
}

export function activityFingerprint(activity: Activity, secret: Uint8Array): string {
  const canonical = JSON.stringify(activity.segments.map(segment =>
    segment.samples.map(sample => [
      sample.timestamp,
      sample.position === undefined ? null : [sample.position.latitude, sample.position.longitude],
      sample.elevationMeters ?? null,
      sample.heartRateBpm ?? null,
    ]),
  ));
  const digest = createHmac('sha256', secret)
    .update(FINGERPRINT_PREFIX)
    .update(canonical)
    .digest('hex');
  return `${FINGERPRINT_VERSION}:${digest}`;
}
