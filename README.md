# RunPulse AI

A personal running analytics platform that turns activity files into actionable performance insights.

## First milestone
The product milestone is to import a running activity, validate and normalize its data, persist it, and display its metrics. RP-02 now delivers secure, local GPX upload and analysis with an ephemeral activity summary; persistence and FIT/TCX are planned. No third-party API credentials are required.

## Development
Requirements: Node.js 22+, npm, Docker Compose.

```sh
npm install
docker compose up -d
npm run dev:api
# In another terminal:
npm run dev:web
```

The API listens on `127.0.0.1:3001` and the web application listens on `127.0.0.1:3000`. Run `npm test` for analytics, GPX parser, API integration, and web tests (recursively discovered under `apps/api/src` and `apps/web/app`), and `npm run typecheck` to check all API source and tests. The API includes a deterministic analytics core, a GPX importer, and a local-only import endpoint; persistence is not implemented.

The API development command does not watch for source changes; restart it after API code or configuration edits. Next.js normally hot-reloads application edits, but restart the web service after changing environment variables, startup scripts, or framework/runtime configuration. Restart both services after dependency or shared workspace configuration changes.

## GPX import library (RP-02)

`parseGpx(input)` in `apps/api/src/gpx-parser.ts` accepts an XML string or UTF-8 `Uint8Array` (including Node Buffers). It returns the format-independent `Activity` model in `activity.ts`: ordered segments containing samples with UTC timestamps, positions in degrees, optional elevation in meters, and optional heart rate in BPM. Missing sensors are omitted. The domain allows missing positions for future indoor FIT/TCX samples; GPX requires both coordinates and a timestamp on every point.

Each GPX track segment becomes a separate activity segment, preserving document order across multiple tracks. **Analytics sum distances only between adjacent samples within each segment.** The parser does not calculate distance, pace or duration, and does not infer continuity between tracks or segments.

Import rules and limitations:

- Maximum input is 10 MiB (10,485,760 bytes), inclusive, checked before decoding or parsing. String sizes use UTF-8 byte length.
- Saxes validates XML 1.0 and namespace bindings during extraction, including ignored metadata. Invalid numeric references, undeclared entities, malformed UTF-8 and forbidden XML characters reject the import. Valid numeric references and the five predefined XML entities are decoded. DOCTYPE events are rejected; custom/external entities are never registered or resolved. Declaration-like text in comments/CDATA is harmless and accepted. No partially parsed activity is returned on failure.
- Only tracks (`trk/trkseg/trkpt`) are imported. Empty tracks/segments are skipped, preserving boundaries between non-empty segments. Route-only, waypoint-only, and entirely empty activities reject. Invalid points reject the entire import; no invalid samples are silently dropped. A one-point segment is valid, even though it cannot establish distance or pace.
- Latitude is bounded to [-90, 90], longitude to [-180, 180]. Numeric values must be finite decimal values. Present elevation must be valid; present heart rate must be a positive safe integer. No physiological plausibility filtering is applied.
- Timestamps require a real calendar date and an explicit timezone between -14:00 and +14:00 (zero minutes at either boundary). They normalize to UTC with millisecond precision; more than three fractional digits reject rather than truncate. Leap seconds are unsupported. Equal timestamps are retained; backwards timestamps within a segment are rejected, comparing actual instants across offsets. Independent segments need not be chronologically ordered.
- Supported GPX namespaces are `http://www.topografix.com/GPX/1/0` and `http://www.topografix.com/GPX/1/1`. The unqualified `version` attribute may be absent; if present it must match the namespace. For compatibility, namespace-free GPX is also accepted, with absent version or version `1.0`/`1.1`. Core descendants must use the root namespace; resetting a namespaced descendant to no namespace does not make it GPX. Creator is not required. Prefixes can change or be rebound; recognition uses resolved URI/local name. Latitude/longitude must be unqualified attributes; foreign names never override them.
- Heart rate is read only from GPX `extensions` containing Garmin `TrackPointExtension/hr` in `http://www.garmin.com/xmlschemas/TrackPointExtension/v1` or `/v2`. Wrapper and `hr` must use the same supported URI, even in namespace-free GPX. Unknown metadata/extensions are ignored semantically but still validated and counted. Duplicate known fields and nested scalar content reject. This is structural/domain validation, not full GPX XSD validation or sequence checking. Other vendor sensor layouts and FIT/TCX parsers remain future work.
- Parsing is synchronous. The input and normalized observations remain in memory, but no whole-document XML tree is built. Limits are inclusive: depth 64, 500,000 elements, 250,000 total attributes (including namespace declarations), 32 attributes per element, and 100,000 imported track points. Element/attribute limits count ignored content and are enforced in parsing callbacks. The point cap allows about 27.8 hours at 1 Hz; actual capacity also depends on byte and element budgets. A future upload endpoint must bound the incoming stream before buffering and control concurrent imports.

Failures throw `ActivityImportError` with a stable `code`: `INPUT_TOO_LARGE`, `RESOURCE_LIMIT`, `UNSAFE_XML`, `INVALID_XML`, or `INVALID_ACTIVITY`. Standalone ENTITY declarations and malformed declaration syntax are XML errors; recognized DOCTYPE declarations are unsafe XML. Error messages do not include input contents. Synthetic fixtures live in TypeScript so personal `.gpx`, `.fit`, and `.tcx` files remain ignored by Git.

See [ADR 0002](docs/adr/0002-bounded-xml-ingestion.md) for the dependency decision, budgets and measured resource observations. To reproduce the synthetic measurements on Node 22: `node --experimental-strip-types scripts/benchmark-gpx.mjs`.

## Activity analytics library

`calculateActivityMetrics(activity)` in `apps/api/src/activity-metrics.ts` consumes the normalized `Activity` model directly. It is deterministic, does not mutate its input, has no file-format dependency, and performs no I/O. Calculations preserve numerical precision; presentation code owns rounding.

| Result field | Definition |
|---|---|
| `totalDistanceMeters` | Sum of within-segment adjacent Haversine distances, using a spherical Earth radius of 6,371,000 m. No elevation adjustment. |
| `elapsedSeconds` | Latest minus earliest timestamp across all samples, including inter-segment gaps. |
| `recordedDurationSeconds` | Sum of segment last-minus-first durations, including pauses and sampling gaps within each segment. **Not moving time.** |
| `averageElapsedPaceSecondsPerKm` | Elapsed seconds / distance in kilometers. Null for incomplete distance, zero distance, zero elapsed time, or overlapping segments. |
| `totalElevationGainMeters`, `totalElevationLossMeters` | Sums of positive/negative adjacent elevation changes within segments; both are nonnegative magnitudes. No smoothing. |
| `averageHeartRateBpm` | Trapezoidal time-weighted mean over eligible intervals only (defined below). |
| `maxHeartRateBpm` | Maximum observed reading, including isolated and duplicate-timestamp readings. Null if no readings exist. |
| `distanceCoverage`, `elevationCoverage` | Fraction of all within-segment adjacent pairs with both required measurements. Null when no pairs exist. |
| `heartRateCoverage` | Eligible heart-rate interval duration / recorded duration. Null when recorded duration is zero or unavailable; zero when positive duration has no eligible intervals. |
| `trackPointCount` | All samples, including duplicates, isolated points and samples without sensors. |
| `hasOverlappingSegments` | Whether any positive-duration segment intervals intersect for positive time. Touching endpoints and zero-duration segments do not count. |

Distance and elevation follow a **strict complete-total policy**: at least one within-segment pair must exist and every such pair must have the required measurements; otherwise the corresponding total is null. Elevation gain and loss are both null if elevation coverage is incomplete. Missing values are never zero-filled or bridged. Complete identical positions/flat elevations yield real zero totals. Pair-based coverage weights every pair equally, including pairs with duplicate timestamps; it does not represent elapsed time or sensor accuracy.

For heart rate, an adjacent interval is eligible only if both readings exist and its duration is **greater than zero and at most 30 seconds**. Its contribution is `(startBpm + endBpm) / 2 × duration`; divide the summed contributions by eligible duration. Missing readings break both neighboring intervals. Gaps over 30 seconds are entirely uncovered, with no extrapolation or partial credit, but remain in recorded duration. Duplicate timestamps receive no weight; the immediately adjacent readings still define their positive-duration neighboring intervals. There is no carry-forward, segment bridging, or extrapolation past an endpoint. The 30-second cutoff is an MVP policy, not a physiological guarantee. Always interpret the average alongside its duration-based coverage.

Segments aggregate additively regardless of input order. Overlapping segments can double-count distance, elevation and heart-rate observations; recorded duration can exceed elapsed time. The engine reports `hasOverlappingSegments` and returns null elapsed pace in this case. It does not merge or deduplicate overlapping recordings. Heart-rate coverage remains relative to the same additive recorded-duration denominator.

An empty activity has count 0, overlap false and null metrics. Empty segments are ignored. Single-point activities have zero elapsed/recorded duration and null pair metrics/coverage, pace, and weighted heart rate; an observed HR maximum remains available. Multiple isolated segments can have positive elapsed time but zero recorded duration. Zero-duration pairs still contribute spatial/elevation observations and pair coverage, but never HR weight.

Callers must provide canonical UTC ISO timestamps with millisecond precision, finite in-range coordinates when present, finite elevation when present, and positive safe-integer observed BPM when present. Invalid values, backwards timestamps within a segment, and unrepresentable arithmetic throw `RangeError`; absent optional sensors do not. No GPS jump filtering, elevation smoothing, moving-time detection or medical interpretation is performed. See [ADR 0003](docs/adr/0003-activity-metric-definitions.md) for definitions, examples and limitations.

See [product vision](docs/product-vision.md), [architecture decision](docs/adr/0001-modular-monolith.md), and [backlog](docs/backlog.md).

## Local Activity Import API (RP-02)

`POST /activities/import` accepts one multipart file in the `file` field and reuses the bounded GPX parser and analytics engine. It returns activity start/end times, segment and point counts, calculated metrics, and coverage; unavailable metrics remain `null`. The response excludes coordinates, filenames and file contents. Files and activity data are processed in memory and are not persisted.

Uploads are limited to 10 MiB, one file/part, no text fields, and a 60-second body-receive deadline. One import may be in flight per API process; additional imports receive `429`. Stable error responses distinguish invalid requests/content (`400`), unsupported formats (`415`), oversized files (`413`), timed-out uploads (`408`), capacity saturation (`429`) and unexpected failures (`500`). GPX input must be UTF-8 XML 1.0; UTF-8 BOMs are accepted. CORS is disabled. The API binds to loopback only; do not expose it on a network before authentication and data isolation are implemented. Synchronous parsing can block the event loop, so byte, parser-work and concurrency limits remain important. See [ADR 0004](docs/adr/0004-local-activity-import-api.md).

## Local GPX import frontend

The Next.js page provides drag-and-drop and file selection for `.gpx` activities, upload progress, actionable validation/API errors, and a responsive activity summary with metrics and data coverage. It displays the API's calculated results without recalculating analytics; unavailable metrics remain distinct from real zero values. Activities are processed locally in memory and are not currently persisted.

The browser posts multipart data to the same-origin `/api/activities/import` streaming Route Handler, which forwards the upload to the loopback-only NestJS API without buffering the whole request. The server-side `RUNPULSE_API_URL` setting accepts only a loopback HTTP origin and defaults to `http://127.0.0.1:3001`; it must not be used to expose the API remotely. CORS remains disabled. The frontend and API are local-development-only, unauthenticated, and provide no user or data isolation. Do not expose them on a network until authentication and data-isolation requirements are implemented.

## Privacy
Activity files may contain sensitive location and health data. Do not commit personal activity files, credentials, or production datasets. Use synthetic fixtures for tests.
