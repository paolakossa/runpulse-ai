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

The API listens on port 3001 and the web application on port 3000. Run `npm test` for the initial analytics tests. This scaffold includes a deterministic analytics core and a health endpoint; upload and persistence are not implemented yet.

See [product vision](docs/product-vision.md), [architecture decision](docs/adr/0001-modular-monolith.md), and [backlog](docs/backlog.md).

## Privacy
Activity files may contain sensitive location and health data. Do not commit personal activity files, credentials, or production datasets. Use synthetic fixtures for tests.
