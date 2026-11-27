# RunPulse AI Engineering Guidelines

## Product and architecture

RunPulse helps runners understand training data across wearable vendors. The MVP imports activities, preserves missing sensor data, and presents reliable metrics; medical advice, training prescriptions, live tracking, and vendor integrations are out of scope.

The project is a TypeScript modular monolith: Next.js web app, NestJS API, and PostgreSQL accessed through Prisma migrations. Current capabilities include a bounded GPX parser, deterministic activity analytics, persisted summary endpoints (`POST /activities/import`, `GET /activities`, `GET /activities/:id`, `DELETE /activities/:id`), and a local web application with Overview, paginated Activities, details, deletion, and Import routes. Activity reads and deletion use explicit same-origin API routes; multipart import uses a streaming proxy. The API and database are loopback-only and single-user; authentication and data isolation are not implemented. Persist only summaries and derived metrics, never original files, XML, raw GPS coordinates, or individual heart-rate samples. Keep ingestion, domain calculations, persistence, and presentation separate. Domain logic should be deterministic, side-effect-free, and independent of file formats or frameworks where practical.

## Repository map

- `apps/web/`: Next.js application routes and UI (`app/`), same-origin API proxies, and web package scripts.
- `apps/api/src/`: NestJS entry point, activity domain, GPX parser, analytics, persistence services, and tests.
- `apps/api/prisma/`: Prisma schema and version-controlled additive migrations.
- `docs/product-vision.md`, `docs/backlog.md`: product goals and story acceptance criteria.
- `docs/adr/`: accepted and proposed architectural decisions; consult before changing established policies.
- `scripts/`: recursive API/web test discovery and synthetic GPX benchmarking.
- `compose.yaml`: local PostgreSQL service; `.github/workflows/ci.yml`: CI checks.

## Tooling and commands

Use Node.js >=22.12 and <23 and npm from the repository root; this is an npm workspace. Keep dependency changes in the relevant workspace manifest and root lockfile. Prefer `npm ci` for reproducible installs. Use the public npm registry and an isolated user config, for example `npm ci --userconfig=/dev/null --registry=https://registry.npmjs.org`; never modify global npm configuration.

Common commands:

```sh
npm ci --userconfig=/dev/null --registry=https://registry.npmjs.org
cp .env.example .env
docker compose up -d postgres
npm run db:migrate:deploy
docker compose --profile test up -d postgres-test
npm run db:migrate:test
npm run dev:api
npm run dev:web
npm test
npm run typecheck
npm run build -w @runpulse/web
```

Replace every `.env.example` placeholder with local-only values and generate a 32-byte `ACTIVITY_FINGERPRINT_SECRET` using `openssl rand -hex 32`. Keep development and test credentials separate. The development and test databases use distinct Compose services, ports, and volumes; never reset or remove existing databases/volumes. `npm test` requires an explicit `RUNPULSE_TEST_DATABASE_URL`, validates its local host, port, database, user, and credential separation before Prisma generation, and explicitly propagates the validated URL as `DATABASE_URL` to database-capable test processes. It never falls back to development `DATABASE_URL`. API and web integration tests repeat the guard before loading NestJS or Prisma, including when invoked directly. Use `npm run test:unit` for database-independent tests without PostgreSQL. CI uses an isolated ephemeral PostgreSQL service on loopback port 5432 with the dedicated test database/user.

Run the API and web development commands in separate terminals; both servers bind to loopback for local development. The web app forwards multipart uploads through a same-origin streaming proxy to the API. The API dev command does not watch source changes, so restart it after API code or configuration edits. Next.js normally hot-reloads application edits, but restart the web service after environment, startup-script, or framework/runtime configuration changes. Restart both services after dependency or shared workspace configuration changes. `npm run db:migrate:deploy` is restricted to the configured local development database; `npm run db:migrate:test` requires the explicit isolated test URL. Use only the guarded npm migration commands: Prisma permits `migrate deploy` and `migrate status` against authorized local targets (or the ephemeral CI target), and rejects extra CLI options/custom configs. Client generation does not require a database connection. Never run destructive migration commands or remove volumes. `npm test` runs the full API/web and database-policy suites after validating and propagating the isolated test URL; direct database integration test invocation is guarded. `npm run test:unit` runs database-independent tests without PostgreSQL. `npm run typecheck` checks API source and tests. The web package has a production build command; there is no API build script currently.

## Engineering practices

- Use Test-Driven Development: **Red** (add a focused failing test), **Green** (smallest correct implementation), **Refactor** (improve design while keeping tests green).
- Write clean, readable, typed code. Apply SOLID where useful, prefer simple solutions, and avoid speculative abstractions. Keep responsibilities focused and boundaries explicit.
- Prefer pure domain functions and explicit inputs/outputs. Avoid hidden I/O, mutation, nondeterminism, fabricated defaults, and silent error handling.
- Use English for source code, tests, documentation, and commit messages.
- Use Conventional Commits with the backlog ticket reference, e.g. `feat(RP-02): import bounded GPX activities`.
- Record significant architectural choices, alternatives, consequences, and follow-up concerns in a new or updated ADR under `docs/adr/`. Follow existing ADR conventions; do not duplicate detailed metric or parser policy outside its source of truth.

## Security and privacy

- Treat activity files as sensitive location and health data. Commit synthetic fixtures only; never commit personal `.gpx`, `.fit`, or `.tcx` files, production datasets, or credentials.
- Validate untrusted input before use. Bound input size, parsing work, retained data, and concurrency at ingestion; reject unsafe XML and never resolve external entities. Consult ADR 0002 for current GPX limits and policy.
- Preserve missing sensor values as missing. Do not log raw activity contents or expose sensitive input in errors.
- Keep authentication, authorization, user isolation, and deletion requirements in scope before public exposure.
- Do not change global Git or npm configuration. Do not automatically commit, push, or merge.

## Change workflow and Definition of Done

Before editing, inspect `git status`, relevant diffs, and untracked files. Preserve unrelated work; change only files needed for the task. Do not stage or discard the user's changes.

A change is done when it meets the story's acceptance criteria, focused tests are added and the relevant test suite passes, type checking passes, relevant documentation is updated, and no known blockers remain. Run `git diff --check` before handing off; report any checks that could not be run.
