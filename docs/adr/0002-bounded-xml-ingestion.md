# ADR 0002: Bounded, namespace-aware XML ingestion

Status: Accepted for RP-02 implementation; pending code review

## Context

The first GPX implementation used fast-xml-parser 5.12.1 to build an object tree. Review identified namespace collisions, incomplete XML-reference validation, and resource limits that took effect after allocation. Repairing these around object conversion would introduce a separate namespace/validation layer. The activity domain and deterministic analytics must remain independent of file formats, consistent with ADR 0001.

## Decision

Replace fast-xml-parser with pinned saxes 6.0.0 and its xmlchars dependency. Saxes resolves namespace bindings, validates XML well-formedness, decodes predefined/numeric references and emits element/attribute events. Our handler recognizes GPX paths and validates domain values; it does not tokenize XML or use global regexes to validate XML. Decimal and timestamp lexical validation remains domain logic.

Alternatives considered:

- Keep fast-xml-parser: convenient object mapping, but requires more surrounding namespace, reference and pre-allocation validation logic for this task.
- Saxes: a small event-driven interface, strict well-formedness checks and built-in TypeScript declarations. It requires explicit GPX state handling but avoids a full XML tree and lets budgets abort parsing early.
- A custom XML scanner or regex validator: rejected because maintaining XML and namespace correctness would become application responsibility.

The [saxes upstream repository](https://github.com/lddubeau/saxes) was archived on 2025-12-31. This is a maintenance risk, not evidence of a current vulnerability. Pin the version, retain adversarial regression tests and run dependency audits. Reassess the dependency if advisories or conformance defects emerge; do not compensate by growing a custom XML parser. The public npm audit at implementation time reported zero vulnerabilities across the workspace, including development dependencies.

## XML and format policy

- XML 1.0 only; byte input must be valid UTF-8. XML declarations specifying other versions/encodings reject. All parsed content, including ignored metadata, is checked by saxes. Parsing aborts on the first error; error messages never expose file contents.
- Reject all DOCTYPE events. Never register custom entities or perform external resolution. Numeric references and the five predefined XML entities are supported. A standalone ENTITY declaration is malformed XML. Comments/CDATA containing declaration-like text remain ordinary data.
- GPX 1.0/1.1 use their respective Topografix namespace URIs. If supplied, unqualified version must match. An absent version/creator is tolerated; this is not XSD validation. Namespace-free GPX is an explicit compatibility mode, allowing version 1.0/1.1 or no version. Core descendants must retain the root URI. Coordinates must be unqualified attributes.
- Garmin TrackPointExtension v1/v2 requires the recognized URI on both wrapper and hr. Namespace-free/unknown heart-rate extensions are ignored, including when the GPX root itself is namespace-free.
- Ignore unknown elements semantically; still validate their XML and charge their resource usage. Known scalar fields cannot contain nested elements and known singular fields cannot repeat. GPX element sequence is not schema-validated; positive test fixtures nevertheless use valid sequence order.
- Every imported point needs valid coordinates and an explicitly zoned timestamp. Offsets are bounded to ±14:00; at most three fractional digits are accepted. Duplicate timestamps remain; backwards instants within a segment reject. Independent segments can overlap in time. Empty segments/tracks are skipped without joining non-empty segments. An activity without points rejects.
- Preserve absent sensors, reject invalid present values. No analytics, persistence, I/O, authentication or upload endpoint is introduced.

## Resource budget

All limits are inclusive and apply per call:

| Budget | Limit | Rationale/enforcement |
|---|---:|---|
| Input bytes | 10 MiB | Existing requirement; checked before decoding/parsing. |
| Open element depth | 64 | Normal GPX paths are shallow; headroom for vendor metadata, while bounding parser/handler stacks. Checked on opening-tag start. |
| Elements | 500,000 | Allows five elements per sample at the point cap, less document overhead; bounds wide ignored metadata. Checked on opening-tag start. |
| Total attributes | 250,000 | Allows two coordinates per point plus metadata headroom; namespace declarations also count. Checked on attribute events. |
| Attributes per element | 32 | Headroom for ordinary GPX/vendor attributes while limiting per-tag maps. Checked on attribute events. |
| Imported track points | 100,000 | About 27.8 hours at 1 Hz; bounds retained normalized samples. Checked before point allocation. |

These are ingestion policies, not GPX schema maxima. Large or extension-heavy valid files may hit a lower budget before the point cap. Counters include ignored content except the point counter, which counts imported points; ignored lookalike points remain bounded by element count. No override is exposed to callers.

Saxes can buffer a single token (text, attribute, comment or DTD) before delivering its event; the input cap bounds that exposure. This is not a strict heap or wall-clock limit. The entire input and result remain in memory, and synchronous execution blocks the calling thread. Future uploads need ingress byte limits and concurrency control; workers can be introduced if measurements justify them.

## Validation and representative observations

Regression tests cover namespace collisions/rebinding, invalid references in ignored data and attributes, valid references, declarations, timestamps, sensor absence/invalidity, empty segments, and exact/one-over resource boundaries. A nested test file exercises recursive discovery on Node 22 without shell glob dependencies. A further test confirms depth rejection before malformed trailing XML is reached.

`node --experimental-strip-types scripts/benchmark-gpx.mjs` runs each synthetic scenario in a separate process. On local macOS, Node 22.23.5, one representative run observed:

| Scenario | Input bytes | Elapsed | Process peak RSS | Heap growth during parse |
|---|---:|---:|---:|---:|
| 100,000 points | 6,400,121 | 359 ms | 133 MiB | 35 MiB |
| 500,000 elements, mostly ignored metadata | 2,000,182 | 183 ms | 85 MiB | 4 MiB |
| Depth 65, rejected | 647 | 1 ms | 79 MiB | <1 MiB |

Peak RSS includes Node, TypeScript loading, fixture generation and the result. Heap growth includes garbage awaiting collection; it is not retained heap. These observations are illustrative, not performance assertions, exhaustive worst-case measurements, or production sizing guarantees. CI tests use bounded cases without timing thresholds to avoid hardware-dependent failures.
