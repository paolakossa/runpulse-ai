# ADR 0003: Deterministic activity metrics and explicit coverage

Status: Accepted for RP-02 implementation; pending code review

## Context and decision

RP-02 ingestion produces format-independent observations, grouped into disconnected segments. The next increment derives metrics without depending on GPX, FIT, TCX, XML, persistence or UI behavior. Use a pure `calculateActivityMetrics(Activity): ActivityMetrics` function, retain the existing domain model, and reuse `averagePaceSecondsPerKm`. No dependency is added and parser behavior is unchanged.

The engine returns a new result, reads samples in their supplied order, and never mutates the input. It validates all observations, including isolated samples and samples excluded from heart-rate weighting. Canonical normalized UTC ISO timestamps must round-trip through `Date` unchanged (for ordinary years, `YYYY-MM-DDTHH:mm:ss.sssZ`); file adapters own normalization. Present coordinates must be finite with latitude in [-90, 90] and longitude in [-180, 180]. Present elevation must be finite and observed BPM a positive safe integer, consistent with the current normalized importer contract. Invalid present values or backwards timestamps within a segment throw `RangeError`. Missing optional values remain missing. Arithmetic that cannot be represented as a finite number also throws rather than returning NaN/Infinity.

## Metric definitions

For each segment, consider only immediate adjacent pairs. Never join the last observation of one segment to the first of another. Never search past missing measurements to construct a pair.

### Distance, elevation and pair coverage

- Distance uses the Haversine formula with radius 6,371,000 meters. For latitudes φ and longitude difference Δλ in radians, `a = sin²(Δφ/2) + cos(φ1)cos(φ2)sin²(Δλ/2)` and `distance = 2R atan2(sqrt(a), sqrt(1-a))`. Clamp `a` to [0, 1] to protect antipodal calculations against floating-point error. Sum distances from valid adjacent positions. Elevation does not alter distance.
- Elevation gain sums positive adjacent elevation differences; loss sums the magnitude of negative differences. No smoothing or minimum-change threshold is applied.
- Let P be the total number of within-segment adjacent pairs. `distanceCoverage = positionedPairs / P` and `elevationCoverage = elevationPairs / P`. Both are null if P is zero. Missing a measurement invalidates each adjacent pair touching it, not a newly bridged pair. Boundaries and singleton segments contribute no pairs. Duplicate timestamps still contribute pairs.
- A distance total is returned only when P > 0 and every pair has positions. Both elevation totals are returned only when P > 0 and every pair has elevations. Otherwise the affected total(s) are null, even when some valid pairs have measurable changes. This prevents observed partial sums from masquerading as complete totals. A complete flat path/elevation yields zero rather than null.
- Coverage is **pair-based**, not time-, distance-, or accuracy-based. A zero-duration pair and a long-duration pair have equal coverage weight. A singleton missing a sensor does not invalidate a complete total from other segments because it creates no pair.

Example: elevations `[0, 10, missing, -20]` contain three adjacent pairs, only one complete. Elevation coverage is 1/3 and both totals are null. No 10-to--20 change is inferred. Complete elevations `[0, 10.125, 4.5, 4.5, 20]` yield gain 25.625 m and loss 5.625 m.

### Time and elapsed pace

- `elapsedSeconds` is global latest timestamp minus global earliest timestamp, divided by 1000. It includes inter-segment gaps and does not depend on segment array order.
- `recordedDurationSeconds` sums each non-empty segment's last-minus-first timestamp, divided by 1000. It includes stationary periods and gaps inside a segment, including HR sampling gaps over 30 seconds. It is **not moving time** and is not a claim that sensors were continuously active.
- `averageElapsedPaceSecondsPerKm` uses the existing helper: elapsed seconds / (distance meters / 1000). It is null if distance is incomplete/unavailable, distance is zero, elapsed time is zero/unavailable, or positive-duration segments overlap.
- Empty segments are ignored. Empty activities return null duration metrics; singleton segments contribute zero recorded duration. Multiple singletons can have positive elapsed time and zero recorded duration.

Example: segment intervals [0, 10] and [100, 120] yield elapsed 120 s and recorded duration 30 s. No 90-second gap is counted as recorded time.

### Heart rate and duration coverage

An interval is eligible only when both adjacent endpoint HR readings exist and `0 < duration ≤ 30 seconds`. For eligible interval i, let `mean_i = (HR_start + HR_end) / 2` and `weight_i = duration_i`. Report `averageHeartRateBpm = sum(mean_i × weight_i) / sum(weight_i)`, or null if no eligible positive duration exists. This is trapezoidal integration: a linear interpolation assumption between measured endpoints, not an arithmetic sample mean.

- Missing readings exclude both neighboring intervals. No carry-forward or interpolation across a missing reading is allowed.
- Gaps over 30 seconds are excluded in their entirety, not capped to 30 seconds. They remain in the recorded-duration denominator.
- Duplicate-timestamp intervals have zero weight. Observations remain in sequence: each positive interval uses its immediate endpoints, even when two readings disagree at a duplicate timestamp. No deduplication is attempted.
- No weighting crosses segments or extrapolates beyond the first/last reading.
- `heartRateCoverage = sum(eligible durations) / recorded duration`. It is zero when duration is positive but no eligible intervals exist, and null when recorded duration is zero/unavailable. This is **duration-based**, unlike distance/elevation coverage.
- `maxHeartRateBpm` is the highest observed valid reading, regardless of weighting eligibility, duplicates, isolation or gaps. It is null only when no readings exist.

Example: `(0 s, 100 BPM), (10 s, 120 BPM), (30 s, 180 BPM)` yields `(110×10 + 150×20)/30 = 136.666… BPM`, coverage 1, and maximum 180 BPM. Replacing the middle reading with missing yields no eligible intervals: average null, coverage 0, maximum 180 BPM. With `(0,100), (10,120), (10,200), (20,160)`, the zero-duration pair is unweighted; the two other intervals yield 145 BPM with full coverage.

The 30-second cutoff is an explicitly approved MVP policy, not a physiological guarantee or quality score. The average describes only covered recording intervals and can be unrepresentative at low coverage; consumers should present coverage alongside it.

### Overlap and counts

`trackPointCount` counts every supplied sample, including duplicates, missing sensors and isolated points. `hasOverlappingSegments` detects a positive-duration intersection between segment time intervals. Touching endpoints, singleton segments and segments with only one unique timestamp do not count as time overlap. Detection sorts only local interval summaries, never input segments or samples.

Overlapping segments are aggregated additively. There is no merge, deduplication or attempt to identify the authoritative recording. Distance, elevation, recorded duration and HR weights may double-count observations; recorded duration may exceed elapsed wall-clock time. Coverage denominators use the same additive pairs/durations, keeping fractions in [0, 1]. **Elapsed pace is null whenever overlap is detected**, even if distance coverage is complete, because additive distance divided by elapsed time may mislead.

Example: [0,10] at 100 BPM and [5,15] at 200 BPM yield elapsed 15 s, recorded duration 20 s, weighted HR 150 BPM, coverage 1, overlap true, and null elapsed pace.

## Edge-case summary

| Input | Result |
|---|---|
| No samples | Count 0, overlap false, all metrics/coverage null. |
| One sample | Elapsed/recorded duration 0; pair totals/coverage, pace and weighted HR null; observed max HR retained. |
| Complete identical coordinates / flat elevations | Zero distance/gain/loss; pace null for zero distance. |
| Distinct coordinates at identical timestamps | Spatial changes still count; HR receives no zero-duration weight; pace null if overall elapsed time is zero. |
| Positive recorded duration, no sensor readings | Distance/elevation totals and HR metrics null, all coverage fractions 0. |
| Only isolated positioned/elevated samples | No bridged pairs; pair totals/coverage null. |
| Incomplete sensor pairs | Affected total null, corresponding pair coverage reports availability. |
| Overlapping segments | Additive aggregates, overlap true, elapsed pace null. |

## Precision, limitations and validation

Calculations use unrounded JavaScript numbers; rounding belongs to presentation. Duration accumulation uses integer milliseconds before conversion to seconds. Floating-point summation may differ by tiny amounts when segment order changes; comparisons use appropriate tolerances rather than claiming arbitrary-precision arithmetic. Haversine assumes a sphere, not a full ellipsoidal geodesic model. Sensor availability does not establish accuracy: GPS noise/jumps, elevation noise and HR spikes remain observable. Long spatial gaps are straight-line sampled distances; the HR cutoff does not alter distance or elevation rules.

This increment does not implement moving-time detection, smoothing, race predictions, advanced training metrics, AI, persistence, endpoints or UI. Future file adapters remain responsible for producing normalized observations. The analytics function does not inherit GPX byte/count limits; upstream ingestion must bound workload. Work is O(N + S log S) for N samples and S positive-duration segments, with O(S) interval-summary storage.

Tests use synthetic domain observations without importing XML/parser code. Geographic expectations use independently computed spherical arcs (equatorial, meridian, antimeridian, polar and antipodal); HR/elevation/time expectations use hand calculations. Tests cover partial pair coverage, strict null totals, additive overlap and suppressed pace, endpoint-touching intervals, irregular sampling, duplicate timestamps, cutoff boundaries, invalid observations, finite arithmetic and frozen-input immutability. The existing recursive Node test runner discovers the suite; API type checking covers it.
