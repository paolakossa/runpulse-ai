# ADR 0001: Start with a modular monolith

Status: Accepted

Use a TypeScript npm workspace with Next.js for the web interface, NestJS for the API and PostgreSQL for persistence. Keep activity ingestion and deterministic analytics separate within the API. Use version-controlled Prisma migrations for schema changes. Use synchronous bounded uploads initially; add queues and object storage only when measured workloads justify them.

Trade-offs: two application processes simplify API boundaries but add local setup; a single local database reduces operational overhead. AI insights will consume calculated metrics, not replace deterministic calculations. Cloud infrastructure is deferred until the local vertical slice works. Activity persistence and its privacy/fingerprint policies are detailed in [ADR 0005](0005-local-activity-persistence.md).
