# RunPulse AI

A personal running analytics platform that turns activity files into actionable performance insights.

## First milestone
Import a running activity, validate and normalize its data, persist it, and display its metrics. GPX is the first supported format; FIT and TCX are planned. No third-party API credentials are required.

## Development
Requirements: Node.js 22+, npm, Docker Compose.

```sh
npm install
docker compose up -d
npm run dev:api
# In another terminal:
npm run dev:web
```

The API listens on port 3001 and the web application on port 3000. Run `npm test` for all analytics and GPX parser tests (recursively discovered under `apps/api/src`), and `npm run typecheck` to check all API source and tests. This scaffold includes a deterministic analytics core, a GPX importer library and a health endpoint; upload and persistence are not implemented yet.

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


See [product vision](docs/product-vision.md), [architecture decision](docs/adr/0001-modular-monolith.md), and [backlog](docs/backlog.md).

## Privacy
Activity files may contain sensitive location and health data. Do not commit personal activity files, credentials, or production datasets. Use synthetic fixtures for tests.
