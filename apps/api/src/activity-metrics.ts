import type { Activity, ActivitySample } from './activity.ts';
import { averagePaceSecondsPerKm } from './metrics.ts';

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_HEART_RATE_INTERVAL_MS = 30_000;

export interface ActivityMetrics {
  totalDistanceMeters: number | null;
  elapsedSeconds: number | null;
  recordedDurationSeconds: number | null;
  averageElapsedPaceSecondsPerKm: number | null;
  totalElevationGainMeters: number | null;
  totalElevationLossMeters: number | null;
  averageHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  /** Covered duration / recorded duration, not elapsed wall-clock time. */
  heartRateCoverage: number | null;
  /** Complete position pairs / all within-segment adjacent pairs. */
  distanceCoverage: number | null;
  /** Complete elevation pairs / all within-segment adjacent pairs. */
  elevationCoverage: number | null;
  trackPointCount: number;
  hasOverlappingSegments: boolean;
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Activity measurements and calculations must be finite.');
  return value;
}

/** Validate normalized domain observations, including isolated/unweighted samples. */
function validateSample(sample: ActivitySample): number {
  const time = typeof sample.timestamp === 'string' ? Date.parse(sample.timestamp) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== sample.timestamp) {
    throw new RangeError('Activity timestamps must be normalized UTC ISO timestamps with millisecond precision.');
  }
  const position = sample.position;
  if (position !== undefined) {
    if (position === null || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude) ||
        Math.abs(position.latitude) > 90 || Math.abs(position.longitude) > 180) {
      throw new RangeError('Activity coordinates must be finite and within valid ranges.');
    }
  }
  if (sample.elevationMeters !== undefined) finite(sample.elevationMeters);
  if (sample.heartRateBpm !== undefined && (!Number.isSafeInteger(sample.heartRateBpm) || sample.heartRateBpm <= 0)) {
    throw new RangeError('Observed heart rate must be a positive safe integer.');
  }
  return time;
}

function haversineMeters(from: NonNullable<ActivitySample['position']>, to: NonNullable<ActivitySample['position']>): number {
  // Longitude does not distinguish positions at the same exact pole.
  if (from.latitude === to.latitude && Math.abs(from.latitude) === 90) return 0;
  // Coordinates are already range-validated. Wrap only when needed: adding
  // 180/360 before a modulo would erase very small legitimate differences.
  let longitudeDegrees = to.longitude - from.longitude;
  if (longitudeDegrees > 180) longitudeDegrees -= 360;
  else if (longitudeDegrees < -180) longitudeDegrees += 360;

  const radians = Math.PI / 180;
  const latitudeDelta = (to.latitude - from.latitude) * radians;
  const longitudeDelta = longitudeDegrees * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  // Floating-point error near antipodes can otherwise put a outside [0, 1].
  const clamped = Math.max(0, Math.min(1, a));
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

/** Positive-duration intersections only; touching endpoints are not overlap. */
function hasOverlappingIntervals(intervals: { start: number; end: number }[]): boolean {
  // Only local summaries are sorted; the activity and sample order are untouched.
  intervals.sort((a, b) => a.start - b.start);
  let latestEnd = -Infinity;
  for (const interval of intervals) {
    if (interval.start < latestEnd) return true;
    latestEnd = Math.max(latestEnd, interval.end);
  }
  return false;
}

/** Pure, format-independent metrics. Definitions and missing-data policy: ADR 0003. */
export function calculateActivityMetrics(activity: Activity): ActivityMetrics {
  let trackPointCount = 0, pairCount = 0, distancePairs = 0, elevationPairs = 0;
  let distanceMeters = 0, elevationGain = 0, elevationLoss = 0;
  let firstTime = Infinity, lastTime = -Infinity, recordedMs = 0;
  let coveredHeartRateMs = 0, weightedHeartRate = 0;
  let maxHeartRateBpm: number | null = null;
  const intervals: { start: number; end: number }[] = [];

  for (const segment of activity.segments) {
    let previous: ActivitySample | undefined;
    let previousTime = 0, segmentStart = 0;
    for (const sample of segment.samples) {
      const time = validateSample(sample);
      trackPointCount++;
      firstTime = Math.min(firstTime, time);
      lastTime = Math.max(lastTime, time);
      if (sample.heartRateBpm !== undefined) maxHeartRateBpm = Math.max(maxHeartRateBpm ?? sample.heartRateBpm, sample.heartRateBpm);
      if (previous === undefined) {
        segmentStart = time;
      } else {
        const durationMs = time - previousTime;
        if (durationMs < 0) throw new RangeError('Timestamps must not go backwards within a segment.');
        pairCount++;
        if (previous.position !== undefined && sample.position !== undefined) {
          distancePairs++;
          distanceMeters = finite(distanceMeters + haversineMeters(previous.position, sample.position));
        }
        if (previous.elevationMeters !== undefined && sample.elevationMeters !== undefined) {
          elevationPairs++;
          const delta = finite(sample.elevationMeters - previous.elevationMeters);
          elevationGain = finite(elevationGain + Math.max(delta, 0));
          elevationLoss = finite(elevationLoss + Math.max(-delta, 0));
        }
        if (durationMs > 0 && durationMs <= MAX_HEART_RATE_INTERVAL_MS &&
            previous.heartRateBpm !== undefined && sample.heartRateBpm !== undefined) {
          coveredHeartRateMs += durationMs;
          weightedHeartRate = finite(weightedHeartRate + (previous.heartRateBpm + sample.heartRateBpm) / 2 * durationMs);
        }
      }
      previous = sample;
      previousTime = time;
    }
    if (previous !== undefined) {
      recordedMs = finite(recordedMs + (previousTime - segmentStart));
      if (previousTime > segmentStart) intervals.push({ start: segmentStart, end: previousTime });
    }
  }

  const hasOverlappingSegments = hasOverlappingIntervals(intervals);
  const completeDistance = pairCount > 0 && distancePairs === pairCount;
  const totalDistanceMeters = completeDistance ? distanceMeters : null;
  const completeElevation = pairCount > 0 && elevationPairs === pairCount;
  const elapsedSeconds = trackPointCount > 0 ? (lastTime - firstTime) / 1000 : null;
  const averageElapsedPaceSecondsPerKm = hasOverlappingSegments || totalDistanceMeters === null || elapsedSeconds === null
    ? null : averagePaceSecondsPerKm(totalDistanceMeters, elapsedSeconds);
  return {
    totalDistanceMeters,
    elapsedSeconds,
    recordedDurationSeconds: trackPointCount > 0 ? recordedMs / 1000 : null,
    averageElapsedPaceSecondsPerKm: averageElapsedPaceSecondsPerKm === null ? null : finite(averageElapsedPaceSecondsPerKm),
    totalElevationGainMeters: completeElevation ? elevationGain : null,
    totalElevationLossMeters: completeElevation ? elevationLoss : null,
    averageHeartRateBpm: coveredHeartRateMs > 0 ? weightedHeartRate / coveredHeartRateMs : null,
    maxHeartRateBpm,
    heartRateCoverage: recordedMs > 0 ? coveredHeartRateMs / recordedMs : null,
    distanceCoverage: pairCount > 0 ? distancePairs / pairCount : null,
    elevationCoverage: pairCount > 0 ? elevationPairs / pairCount : null,
    trackPointCount,
    hasOverlappingSegments,
  };
}
