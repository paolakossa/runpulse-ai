# RunPulse AI Engineering Guidelines

## Product and architecture

RunPulse helps runners understand training data across wearable vendors. The MVP imports activities, preserves missing sensor data, and presents reliable metrics; medical advice, training prescriptions, live tracking, and vendor integrations are out of scope.

The project is a TypeScript modular monolith: Next.js web app, NestJS API, and PostgreSQL for planned persistence. Current API capabilities include a health endpoint, a bounded GPX parsing library, and deterministic activity analytics; upload endpoints and persistence are not implemented. Keep ingestion, domain calculations, persistence, and presentation separate. Domain logic should be deterministic, side-effect-free, and independent of file formats or frameworks where practical.

## Repository map

- `apps/web/`: Next.js UI (`app/`) and web package scripts.
- `apps/api/src/`: NestJS entry point, activity domain, GPX parser, analytics, and tests.
- `docs/product-vision.md`, `docs/backlog.md`: product goals and story acceptance criteria.
- `docs/adr/`: accepted and proposed architectural decisions; consult before changing established policies.
- `scripts/`: recursive API test discovery and synthetic GPX benchmarking.
- `compose.yaml`: local PostgreSQL service; `.github/workflows/ci.yml`: CI checks.

## Tooling and commands

Use Node.js 22+ and npm from the repository root; this is an npm workspace. Keep dependency changes in the relevant workspace manifest and root lockfile. Prefer `npm ci` for reproducible installs. If installing dependencies, use the public npm registry and an isolated temporary user config; never modify global npm configuration.

Common commands:

```sh
npm ci
docker compose up -d
npm run dev:api
npm run dev:web
npm test
npm run typecheck
npm run build -w @runpulse/web
```

Run the API and web development commands in separate terminals. `npm test` discovers API tests recursively. `npm run typecheck` checks API source and tests. The web package has a production build command; there is no API build script currently.

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
