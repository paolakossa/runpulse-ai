import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, ActivitySample } from './activity.ts';
import { calculateActivityMetrics } from './activity-metrics.ts';

// Synthetic domain observations, intentionally independent of any file parser.
function sample(seconds: number, values: Partial<Omit<ActivitySample, 'timestamp'>> = {}): ActivitySample {
  return { timestamp: new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString(), ...values };
}
function activity(...segments: ActivitySample[][]): Activity {
  return { segments: segments.map(samples => ({ samples })) };
}
function position(latitude: number, longitude: number): ActivitySample['position'] {
  return { latitude, longitude };
}
function close(actual: number | null, expected: number, tolerance = 1e-9): void {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('equatorial arc distance, elapsed time and pace use independent analytical expectations', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { position: position(0, 0) }), sample(10, { position: position(0, 0.001) }),
  ]));
  // Equatorial 0.001 degree arc: 2*pi*6371000/360000 = 111.19492664455873 m.
  close(result.totalDistanceMeters, 111.19492664455873, 1e-7);
  assert.equal(result.elapsedSeconds, 10);
  assert.equal(result.recordedDurationSeconds, 10);
  close(result.averageElapsedPaceSecondsPerKm, 89.93216059187306, 1e-7);
  assert.equal(result.distanceCoverage, 1);
  assert.equal(result.trackPointCount, 2);
});

test('meridian, antimeridian, non-equatorial and antipodal distances match spherical arcs', () => {
  for (const [start, end, expected] of [
    [position(0, 0), position(1, 0), 111194.92664455874],
    [position(0, 179), position(0, -179), 222389.85328911748],
    [position(0, 0), position(0, 180), 20015086.79602057],
    // Across the pole: two 30-degree arcs, total spherical angle pi/3.
    [position(60, 0), position(60, 180), 6671695.598673523],
  ] as const) {
    close(calculateActivityMetrics(activity([sample(0, { position: start }), sample(10, { position: end })])).totalDistanceMeters, expected, 1e-6);
  }
});

test('equivalent antimeridian positions have exactly zero distance and null pace in either direction', () => {
  for (const latitude of [0, 45, -45]) {
    for (const longitude of [180, -180]) {
      const result = calculateActivityMetrics(activity([
        sample(0, { position: position(latitude, longitude) }),
        sample(10, { position: position(latitude, -longitude) }),
      ]));
      assert.equal(result.totalDistanceMeters, 0);
      assert.equal(result.averageElapsedPaceSecondsPerKm, null);
    }
  }
});

test('equivalent positions at either pole have exactly zero distance regardless of longitude', () => {
  for (const latitude of [-90, 90]) {
    for (const [start, end] of [[0, 90], [90, 0], [-180, 180], [-45, 120]]) {
      const result = calculateActivityMetrics(activity([
        sample(0, { position: position(latitude, start) }),
        sample(10, { position: position(latitude, end) }),
      ]));
      assert.equal(result.totalDistanceMeters, 0);
      assert.equal(result.averageElapsedPaceSecondsPerKm, null);
    }
  }
  const oppositePoles = calculateActivityMetrics(activity([
    sample(0, { position: position(-90, 0) }), sample(10, { position: position(90, 0) }),
  ]));
  close(oppositePoles.totalDistanceMeters, 20015086.79602057, 1e-6);
});

test('tiny genuine movements stay positive without a distance threshold or modulo cancellation', () => {
  for (const degrees of [1e-12, 1e-14, -1e-14]) {
    const result = calculateActivityMetrics(activity([
      sample(0, { position: position(0, 0) }), sample(10, { position: position(0, degrees) }),
    ]));
    // Equatorial arc length: 111194.92664455874 meters per degree.
    const expected = 111194.92664455874 * Math.abs(degrees);
    close(result.totalDistanceMeters, expected, expected * 1e-12);
    assert.ok(result.totalDistanceMeters! > 0);
    assert.ok(Number.isFinite(result.averageElapsedPaceSecondsPerKm));
    assert.notEqual(result.averageElapsedPaceSecondsPerKm, null);
  }
  const nearPole = calculateActivityMetrics(activity([
    sample(0, { position: position(89.999999, 0) }), sample(10, { position: position(89.999999, 90) }),
  ]));
  assert.ok(nearPole.totalDistanceMeters! > 0);
});

test('small antimeridian crossings retain their short arc length in either direction', () => {
  // Binary-exact offsets avoid ambiguity from rounding the input longitudes.
  const offset = 2 ** -30;
  for (const direction of [-1, 1]) {
    const result = calculateActivityMetrics(activity([
      sample(0, { position: position(0, direction * (180 - offset)) }),
      sample(10, { position: position(0, direction * (-180 + offset)) }),
    ]));
    close(result.totalDistanceMeters, 111194.92664455874 * 2 * offset, 1e-15);
    assert.ok(result.totalDistanceMeters! > 0);
  }
});

test('disconnected and unordered segments preserve gaps and never bridge distance or elevation', () => {
  const first = [sample(0, { position: position(0, 0), elevationMeters: 0 }), sample(10, { position: position(0, 0.001), elevationMeters: 5 })];
  const second = [sample(100, { position: position(60, 80), elevationMeters: 1000 }), sample(120, { position: position(60, 80), elevationMeters: 998 })];
  const result = calculateActivityMetrics(activity(second, [], first));
  close(result.totalDistanceMeters, 111.19492664455873, 1e-7);
  assert.equal(result.elapsedSeconds, 120);
  assert.equal(result.recordedDurationSeconds, 30);
  assert.equal(result.totalElevationGainMeters, 5);
  assert.equal(result.totalElevationLossMeters, 2);
  assert.equal(result.distanceCoverage, 1);
  assert.equal(result.elevationCoverage, 1);
  assert.equal(result.hasOverlappingSegments, false);
  assert.deepEqual(result, calculateActivityMetrics(activity(first, second)));
});

test('identical coordinates and complete flat elevation yield real zero totals', () => {
  const result = calculateActivityMetrics(activity([sample(0, { position: position(0, 0), elevationMeters: 0 }), sample(10, { position: position(0, 0), elevationMeters: 0 })]));
  assert.equal(result.totalDistanceMeters, 0);
  assert.equal(result.totalElevationGainMeters, 0);
  assert.equal(result.totalElevationLossMeters, 0);
  assert.equal(result.averageElapsedPaceSecondsPerKm, null);
});

test('single-point activity has zero durations, unknown pair metrics and observed maximum HR', () => {
  assert.deepEqual(calculateActivityMetrics(activity([sample(0, { position: position(0, 0), elevationMeters: 5, heartRateBpm: 140 })])), {
    totalDistanceMeters: null, elapsedSeconds: 0, recordedDurationSeconds: 0,
    averageElapsedPaceSecondsPerKm: null, totalElevationGainMeters: null, totalElevationLossMeters: null,
    averageHeartRateBpm: null, maxHeartRateBpm: 140, heartRateCoverage: null,
    distanceCoverage: null, elevationCoverage: null, trackPointCount: 1, hasOverlappingSegments: false,
  });
});

test('empty activities and empty segments have no measurable metrics', () => {
  const result = calculateActivityMetrics(activity([], []));
  assert.equal(result.trackPointCount, 0);
  assert.equal(result.hasOverlappingSegments, false);
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'trackPointCount' && key !== 'hasOverlappingSegments') assert.equal(value, null, key);
  }
  assert.deepEqual(result, calculateActivityMetrics(activity()));
});

test('zero-duration observations retain spatial changes and HR maximum but cannot produce pace or weighting', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { position: position(0, 0), elevationMeters: 1, heartRateBpm: 100 }),
    sample(0, { position: position(0, 0.001), elevationMeters: 3, heartRateBpm: 200 }),
  ]));
  close(result.totalDistanceMeters, 111.19492664455873, 1e-7);
  assert.equal(result.totalElevationGainMeters, 2);
  assert.equal(result.elapsedSeconds, 0);
  assert.equal(result.recordedDurationSeconds, 0);
  assert.equal(result.averageElapsedPaceSecondsPerKm, null);
  assert.equal(result.averageHeartRateBpm, null);
  assert.equal(result.heartRateCoverage, null);
  assert.equal(result.maxHeartRateBpm, 200);
});

test('distance coverage is pair-based and incomplete distance makes total and pace null', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { position: position(0, 0) }), sample(1, { position: position(0, 1) }), sample(2), sample(100, { position: position(0, 2) }),
  ]));
  close(result.distanceCoverage, 1 / 3);
  assert.equal(result.totalDistanceMeters, null);
  assert.equal(result.averageElapsedPaceSecondsPerKm, null);
});

test('isolated positions or elevations never create bridged pairs', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { position: position(0, 0), elevationMeters: 0 }), sample(5), sample(10, { position: position(0, 1), elevationMeters: 100 }),
  ]));
  assert.equal(result.distanceCoverage, 0);
  assert.equal(result.elevationCoverage, 0);
  assert.equal(result.totalDistanceMeters, null);
  assert.equal(result.totalElevationGainMeters, null);
  assert.equal(result.totalElevationLossMeters, null);
});

test('partial elevation coverage cannot masquerade as complete gain/loss', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { elevationMeters: 0 }), sample(1, { elevationMeters: 10 }), sample(2), sample(100, { elevationMeters: -20 }),
  ]));
  close(result.elevationCoverage, 1 / 3);
  assert.equal(result.totalElevationGainMeters, null);
  assert.equal(result.totalElevationLossMeters, null);
});

test('coverage counts pairs globally without including segment boundaries or isolated points', () => {
  const result = calculateActivityMetrics(activity(
    [sample(0, { position: position(0, 0), elevationMeters: 1 }), sample(1, { position: position(0, 0), elevationMeters: 1 })],
    [sample(5)],
    [sample(10), sample(11), sample(12), sample(13)],
  ));
  assert.equal(result.distanceCoverage, 0.25);
  assert.equal(result.elevationCoverage, 0.25);
  assert.equal(result.totalDistanceMeters, null);
});

test('separate single-point segments cannot create any measured pair or HR interval', () => {
  const result = calculateActivityMetrics(activity([sample(0, { elevationMeters: 1, heartRateBpm: 100 })], [sample(10, { elevationMeters: 1000, heartRateBpm: 180 })]));
  assert.equal(result.elapsedSeconds, 10);
  assert.equal(result.recordedDurationSeconds, 0);
  assert.equal(result.distanceCoverage, null);
  assert.equal(result.elevationCoverage, null);
  assert.equal(result.totalElevationGainMeters, null);
  assert.equal(result.averageHeartRateBpm, null);
  assert.equal(result.heartRateCoverage, null);
});

test('elevation gain and loss sum signed adjacent differences with no rounding', () => {
  const result = calculateActivityMetrics(activity([0, 10.125, 4.5, 4.5, 20].map((elevationMeters, i) => sample(i, { elevationMeters }))));
  assert.equal(result.totalElevationGainMeters, 25.625);
  assert.equal(result.totalElevationLossMeters, 5.625);
});

test('irregular HR sampling uses trapezoidal duration weighting instead of arithmetic mean', () => {
  const result = calculateActivityMetrics(activity([sample(0, { heartRateBpm: 100 }), sample(10, { heartRateBpm: 120 }), sample(30, { heartRateBpm: 180 })]));
  // (110*10 + 150*20) / 30 = 4100/30, not (100+120+180)/3.
  close(result.averageHeartRateBpm, 136.66666666666666);
  assert.equal(result.heartRateCoverage, 1);
  assert.equal(result.maxHeartRateBpm, 180);
});

test('missing HR breaks both adjacent intervals and never carries a reading forward', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { heartRateBpm: 100 }), sample(10, { heartRateBpm: 120 }), sample(20), sample(30, { heartRateBpm: 200 }),
  ]));
  assert.equal(result.averageHeartRateBpm, 110);
  close(result.heartRateCoverage, 1 / 3);
  assert.equal(result.maxHeartRateBpm, 200);
});

test('HR cutoff includes 30 seconds but excludes an entire longer gap from coverage', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { heartRateBpm: 100 }), sample(30, { heartRateBpm: 120 }), sample(60.001, { heartRateBpm: 200 }),
  ]));
  assert.equal(result.averageHeartRateBpm, 110);
  close(result.heartRateCoverage, 30 / 60.001);
  close(result.recordedDurationSeconds, 60.001);
  assert.equal(result.maxHeartRateBpm, 200);
});

test('duplicate timestamps have no HR weight and preserve immediate interval endpoints', () => {
  const result = calculateActivityMetrics(activity([
    sample(0, { heartRateBpm: 100 }), sample(10, { heartRateBpm: 120 }), sample(10, { heartRateBpm: 200 }), sample(20, { heartRateBpm: 160 }),
  ]));
  assert.equal(result.averageHeartRateBpm, 145); // (110*10 + 180*10)/20.
  assert.equal(result.heartRateCoverage, 1);
  assert.equal(result.maxHeartRateBpm, 200);
  assert.equal(result.trackPointCount, 4);
});

test('HR coverage uses recorded duration, excluding inter-segment gaps', () => {
  const result = calculateActivityMetrics(activity(
    [sample(0, { heartRateBpm: 100 }), sample(10, { heartRateBpm: 120 })],
    [sample(100, { heartRateBpm: 140 }), sample(120, { heartRateBpm: 160 })],
  ));
  assert.equal(result.elapsedSeconds, 120);
  assert.equal(result.recordedDurationSeconds, 30);
  assert.equal(result.heartRateCoverage, 1);
  close(result.averageHeartRateBpm, 136.66666666666666);
});

test('no usable sensor data yields unknown totals and zero coverage over observed pairs/duration', () => {
  const result = calculateActivityMetrics(activity([sample(0), sample(10)]));
  for (const key of ['totalDistanceMeters', 'totalElevationGainMeters', 'totalElevationLossMeters', 'averageElapsedPaceSecondsPerKm', 'averageHeartRateBpm', 'maxHeartRateBpm'] as const) assert.equal(result[key], null);
  assert.equal(result.distanceCoverage, 0);
  assert.equal(result.elevationCoverage, 0);
  assert.equal(result.heartRateCoverage, 0);
  assert.equal(result.trackPointCount, 2);
});

test('HR observations separated only by long gaps provide a maximum but no weighted average', () => {
  const result = calculateActivityMetrics(activity([sample(0, { heartRateBpm: 100 }), sample(60, { heartRateBpm: 200 })]));
  assert.equal(result.averageHeartRateBpm, null);
  assert.equal(result.heartRateCoverage, 0);
  assert.equal(result.maxHeartRateBpm, 200);
});

test('overlapping segments aggregate additively, flag overlap and suppress elapsed pace', () => {
  const first = [sample(0, { position: position(0, 0), elevationMeters: 0, heartRateBpm: 100 }), sample(10, { position: position(0, 0.001), elevationMeters: 10, heartRateBpm: 100 })];
  const second = [sample(5, { position: position(0, 0), elevationMeters: 10, heartRateBpm: 200 }), sample(15, { position: position(0, 0.001), elevationMeters: 0, heartRateBpm: 200 })];
  const result = calculateActivityMetrics(activity(second, first));
  close(result.totalDistanceMeters, 222.38985328911747, 1e-7);
  assert.equal(result.elapsedSeconds, 15);
  assert.equal(result.recordedDurationSeconds, 20);
  assert.equal(result.averageElapsedPaceSecondsPerKm, null);
  assert.equal(result.totalElevationGainMeters, 10);
  assert.equal(result.totalElevationLossMeters, 10);
  assert.equal(result.averageHeartRateBpm, 150);
  assert.equal(result.heartRateCoverage, 1);
  assert.equal(result.distanceCoverage, 1);
  assert.equal(result.hasOverlappingSegments, true);
});

test('nested segment intervals detect overlap regardless of input order', () => {
  const result = calculateActivityMetrics(activity([sample(30), sample(40)], [sample(0), sample(100)], [sample(10), sample(20)]));
  assert.equal(result.hasOverlappingSegments, true);
  assert.equal(result.recordedDurationSeconds, 120);
  assert.equal(result.elapsedSeconds, 100);
});

test('touching segment endpoints and zero-duration segments do not overlap in time', () => {
  const result = calculateActivityMetrics(activity([sample(10), sample(20)], [sample(0), sample(10)], [sample(5)], [sample(7), sample(7)]));
  assert.equal(result.hasOverlappingSegments, false);
  assert.equal(result.recordedDurationSeconds, 20);
});

test('invalid present measurements reject even on isolated points', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => calculateActivityMetrics(activity([sample(0, { elevationMeters: value })])), RangeError);
  }
  for (const value of [NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateActivityMetrics(activity([sample(0, { heartRateBpm: value })])), RangeError);
  }
  for (const coordinates of [position(91, 0), position(-91, 0), position(0, 181), position(0, -181), position(NaN, 0), position(0, Infinity)]) {
    assert.throws(() => calculateActivityMetrics(activity([sample(0, { position: coordinates })])), RangeError);
  }
});

test('invalid or non-normalized timestamps and backwards samples reject', () => {
  for (const timestamp of ['invalid', '2026-02-30T00:00:00.000Z', '2026-01-01T00:00:00', '2026-01-01T00:00:00.0001Z', '2026-01-01T01:00:00.000+01:00']) {
    assert.throws(() => calculateActivityMetrics(activity([{ timestamp }])), RangeError);
  }
  assert.throws(() => calculateActivityMetrics(activity([sample(10), sample(0)])), RangeError);
});

test('unrepresentable arithmetic rejects rather than returning Infinity', () => {
  assert.throws(() => calculateActivityMetrics(activity([sample(0, { elevationMeters: -Number.MAX_VALUE }), sample(1, { elevationMeters: Number.MAX_VALUE })])), RangeError);
});

test('calculations are repeatable and do not mutate frozen input', () => {
  const input = activity([sample(20, { position: position(0, 0) }), sample(30, { position: position(0, 1) })], [sample(0), sample(10)]);
  const original = structuredClone(input);
  for (const segment of input.segments) {
    for (const point of segment.samples) { if (point.position) Object.freeze(point.position); Object.freeze(point); }
    Object.freeze(segment.samples);
    Object.freeze(segment);
  }
  Object.freeze(input.segments);
  Object.freeze(input);
  assert.deepEqual(calculateActivityMetrics(input), calculateActivityMetrics(input));
  assert.deepEqual(input, original);
});
