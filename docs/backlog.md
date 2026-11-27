# Initial backlog

| ID | Story | Acceptance criteria |
|---|---|---|
| RP-01 | Establish workspace | Web and API run locally; analytics tests run in CI |
| RP-02 | Import and analyze GPX (Complete) | Securely parse bounded GPX uploads through the local API; show timestamps, metrics, and coverage in the web dashboard; preserve unavailable values as null; reject unsafe/malformed/oversized input; use synthetic fixtures only |
| RP-03 | Persist activities (Complete) | Versioned schema migration; persist, retrieve, paginate, and delete activity summaries; enforce deterministic duplicate detection and database uniqueness; preserve null/zero semantics |
| RP-04 | Activity dashboard | Show persisted activity history, distance, elapsed duration and pace; handle missing metrics and empty states (RP-02 provides the single-import summary) |
| RP-05 | Authentication and isolation | Users can only access their own activities; protect uploads and reads |
| RP-06 | FIT and TCX | Normalize formats into the same domain model; tests for missing sensors |
| RP-07 | Historical trends | Compare weekly mileage and pace using documented definitions |
| RP-08 | AI insights | Ground responses in calculated metrics; evaluate factual accuracy and avoid medical advice |

Before exposing the application publicly, complete authentication and authorization, data deletion and privacy review.
