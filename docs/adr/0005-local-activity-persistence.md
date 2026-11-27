# ADR 0005: Local summary-only activity persistence

Status: Accepted

## Context

RP-02 imports and analyzes bounded GPX uploads but previously returned an ephemeral summary. RP-03 needs local history while preserving the privacy boundary: source files, XML, GPS samples, and individual heart-rate observations must not be stored. The application remains a local, single-user development system; authentication, authorization, and user isolation are not available.

## Decision

Use PostgreSQL 17 with Prisma ORM 7.10.1 and version-controlled, additive SQL migrations. Prisma 7.10.1 supports Node.js 22.12 and later in the Node 22 line and works with the existing NestJS 11 / TypeScript 5.9 API. Pin Prisma CLI, client, and PostgreSQL adapter together. Do not use Prisma preview/RC releases for this milestone.

Store one row per imported activity in `activities`; no sample, segment, or source-file tables are created. The row contains:

- UUID primary key and database-generated import timestamp.
- Nullable start/end timestamps, segment and point counts.
- Existing nullable calculated metrics, nullable coverage fractions, and overlap indicator.
- A versioned, unique import fingerprint.

PostgreSQL CHECK constraints enforce positive counts, ordered timestamps, valid finite/nonnegative metric ranges, valid coverage fractions, and fingerprint format. SQL constraints are retained in the migration because they are not represented by the Prisma schema. An index on `(imported_at DESC, id DESC)` supports stable history ordering.

Only the compact activity summary is persisted: derived metric values can still reveal sensitive health information, so database access remains local-only. Do not store original GPX bytes, XML, coordinates, individual heart-rate samples, filenames, or activity payloads in logs. Responses include only the summary fields and persistence metadata.

## Duplicate fingerprint

The importer computes `v1:<hex>` as HMAC-SHA-256 over a versioned prefix and canonical JSON of the normalized activity. Canonicalization preserves segment order/boundaries, sample order, normalized UTC timestamps, coordinates, elevation, heart rate, and explicit `null` values for missing sensors. The 32-byte key is provided through `ACTIVITY_FINGERPRINT_SECRET` as exactly 64 hexadecimal characters, generated locally with `openssl rand -hex 32`. There is no default key. The fingerprint is not returned by the API.

The database unique index is authoritative under concurrent requests. The API maps only a uniqueness violation on the fingerprint constraint to `409 DUPLICATE_ACTIVITY`; other constraint or server failures are not mislabeled.

This detects byte-independent but semantically equivalent normalized observations only when their normalized representation is identical. Different point precision, timestamp rounding, segmentation, ordering, sensor values, or export transformations can produce a different fingerprint. The same physical activity imported from GPX, FIT, or TCX will not necessarily deduplicate. It is not a general activity identity or fuzzy matching system.

The fingerprint key must remain stable for the lifetime of stored rows. Losing or rotating it makes previously imported activities appear new. Key rotation requires a planned migration/re-fingerprinting strategy (or a dual-key transition) before changing the configured key; do not silently rotate it. The keyed digest is still sensitive pseudonymous data and should be protected like other activity metadata.

## API contract

- `POST /activities/import`: preserve the RP-02 multipart/security behavior; calculate metrics with the existing pure engine, then store one summary and return it with `activity.id` and `activity.importedAt`.
- `GET /activities`: return `{ items, page, pageSize, total, totalPages }`, ordered by import time descending then ID descending. `page` defaults to 1; `pageSize` defaults to 20 and is capped at 100.
- `GET /activities/:id`: return the same persisted summary shape or `404 ACTIVITY_NOT_FOUND`.
- `DELETE /activities/:id`: delete one summary; return `204`, or `404 ACTIVITY_NOT_FOUND`.

Nullable values remain `null`; real zeroes remain numeric zero. Stable API errors include `409 DUPLICATE_ACTIVITY`, `400 INVALID_ACTIVITY_ID` / `INVALID_PAGINATION`, and sanitized `503 DATABASE_UNAVAILABLE`. Unexpected database failures return a generic `500 INTERNAL_ERROR`. List, read, and delete responses are marked `no-store`.

## Transaction and resource boundaries

The import performs parsing and deterministic calculations before issuing one atomic database insert. No transaction spans upload receipt or CPU-bound parsing. The unique constraint makes concurrent duplicate writes safe across processes, even though upload admission itself is process-local.

Pagination runs the row query and count in a short `RepeatableRead` transaction so a page and its reported total share a snapshot. Deletion uses one database statement. Database connections are loopback-only, pooled to at most five, and configured with bounded connection, idle, and statement timeouts. The API starts without requiring an active database connection; `/health` remains a process-liveness endpoint. Database-dependent operations return sanitized `503` responses when the database is unavailable.

## Migration and environment policy

Keep schema changes in committed Prisma migrations and apply them with the guarded npm migration commands; do not use `migrate reset`, destructive schema synchronization, or volume removal. The migration wrappers accept only `deploy` and `status`, reject forwarded CLI options/custom config paths, and validate destinations against the configured local development database, the explicit isolated test database, or CI's ephemeral test database. The Prisma configuration independently applies the same URL policy. Remote and unrecognized destinations fail closed. Prisma client generation is independent of a live database URL.

Development and test databases use different Compose services, credentials, ports, and volumes. `npm test` requires an explicit `RUNPULSE_TEST_DATABASE_URL`; a centralized policy validates the local host, expected port, dedicated `runpulse_test` user/database, and separation from development credentials before Prisma generation or test subprocesses start. The validated test URL is explicitly propagated as `DATABASE_URL` and `RUNPULSE_TEST_DATABASE_URL` to each database-capable subprocess; there is no fallback to development `DATABASE_URL`. Prisma loads `.env` without overriding validated process environment values. API and web integration tests independently enforce the same guard before loading NestJS or Prisma, including on direct invocation. Database-independent tests are available with `npm run test:unit`. CI sets `CI=true` and uses an ephemeral loopback PostgreSQL service on port 5432 with the dedicated test user/database; the same isolation checks apply. Tests clean up only rows they create. Never run destructive tests or migrations against development data.

Store connection URLs and the fingerprint key in ignored local `.env`, using `.env.example` placeholders only as a template. Existing PostgreSQL volumes retain their initialized credentials; changing environment values does not rotate a password already stored in a volume. Never commit real credentials.

## Consequences and limitations

- The API and database remain loopback-only, unauthenticated, and single-user. Do not expose them on a shared or public network until authentication, authorization, and per-user isolation are implemented.
- Activity deletion removes the live summary row, but does not guarantee backup deletion or secure erasure from storage media. Backup, retention, recovery, and user-request deletion policies remain future work.
- Local PostgreSQL adds a service and migration lifecycle but provides durable local history, database-enforced uniqueness, and reproducible schema changes.
- The list endpoint uses bounded offset pagination; very large histories may require cursor pagination later.
- No raw track reconstruction, fuzzy duplicate matching, cross-format equivalence, cloud persistence, or browser-side persistence is provided.
