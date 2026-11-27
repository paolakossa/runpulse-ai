import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Activity, ActivitySample } from '../activity.ts';
import { parseGpx } from '../gpx-parser.ts';
import { activityFingerprint } from './activity-fingerprint.ts';

const secret = Buffer.alloc(32, 0x5a);

function sample(timestamp: string, values: Partial<Omit<ActivitySample, 'timestamp'>> = {}): ActivitySample {
  return { timestamp, ...values };
}

function activity(...segments: ActivitySample[][]): Activity {
  return { segments: segments.map(samples => ({ samples })) };
}

test('equivalent normalized GPX exports produce the same versioned fingerprint', () => {
  const first = `<gpx version="1.1" creator="one" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
    <trkpt lat="0" lon="0"><ele>0</ele><time>2026-01-01T00:00:00Z</time></trkpt>
    <trkpt lat="0" lon="0.001"><ele>2.5</ele><time>2026-01-01T00:00:10Z</time></trkpt>
  </trkseg></trk></gpx>`;
  const equivalent = `<?xml version="1.0" encoding="UTF-8"?>
    <gpx xmlns="http://www.topografix.com/GPX/1/1" creator="different" version="1.1">
      <trk><trkseg>
        <trkpt lon="0.000" lat="0.0"><time>2026-01-01T00:00:00.000Z</time><ele>0.000</ele></trkpt>
        <trkpt lon="0.0010" lat="0"><time>2026-01-01T00:00:10.000Z</time><ele>2.500</ele></trkpt>
      </trkseg></trk>
    </gpx>`;
  const firstFingerprint = activityFingerprint(parseGpx(first), secret);
  const equivalentFingerprint = activityFingerprint(parseGpx(equivalent), secret);

  assert.match(firstFingerprint, /^v1:[a-f0-9]{64}$/);
  assert.equal(firstFingerprint, equivalentFingerprint);
});

test('fingerprints preserve segment boundaries and sample ordering', () => {
  const start = sample('2026-01-01T00:00:00.000Z', { position: { latitude: 0, longitude: 0 } });
  const middle = sample('2026-01-01T00:00:01.000Z', { position: { latitude: 0, longitude: 0.001 } });
  const end = sample('2026-01-01T00:00:02.000Z', { position: { latitude: 0, longitude: 0.002 } });
  const contiguous = activity([start, middle, end]);
  const split = activity([start, middle], [end]);
  const reordered = activity([start, end, middle]);

  assert.notEqual(activityFingerprint(contiguous, secret), activityFingerprint(split, secret));
  assert.notEqual(activityFingerprint(contiguous, secret), activityFingerprint(reordered, secret));
});

test('fingerprints distinguish missing sensors from zero and preserve zero values', () => {
  const timestamp = '2026-01-01T00:00:00.000Z';
  const position = { latitude: 0, longitude: 0 };
  const missing = activity([sample(timestamp, { position })]);
  const zeroElevation = activity([sample(timestamp, { position, elevationMeters: 0 })]);
  const observedHeartRate = activity([sample(timestamp, { position, heartRateBpm: 120 })]);

  assert.notEqual(activityFingerprint(missing, secret), activityFingerprint(zeroElevation, secret));
  assert.notEqual(activityFingerprint(missing, secret), activityFingerprint(observedHeartRate, secret));
  assert.equal(activityFingerprint(zeroElevation, secret), activityFingerprint(zeroElevation, secret));
});

test('fingerprints change when observations or the secret change', () => {
  const baseline = activity([
    sample('2026-01-01T00:00:00.000Z', { position: { latitude: 1, longitude: 2 } }),
    sample('2026-01-01T00:00:01.000Z', { position: { latitude: 1, longitude: 2.001 } }),
  ]);
  const changed = activity([
    sample('2026-01-01T00:00:00.000Z', { position: { latitude: 1, longitude: 2 } }),
    sample('2026-01-01T00:00:01.000Z', { position: { latitude: 1, longitude: 2.002 } }),
  ]);

  assert.notEqual(activityFingerprint(baseline, secret), activityFingerprint(changed, secret));
  assert.notEqual(activityFingerprint(baseline, secret), activityFingerprint(baseline, Buffer.alloc(32, 0x5b)));
});
