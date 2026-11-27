# Initial backlog

| ID | Story | Acceptance criteria |
|---|---|---|
| RP-01 | Establish workspace | Web and API run locally; analytics tests run in CI |
| RP-02 | Import and analyze GPX (Complete) | Securely parse bounded GPX uploads through the local API; show timestamps, metrics, and coverage in the web dashboard; preserve unavailable values as null; reject unsafe/malformed/oversized input; use synthetic fixtures only |
| RP-03 | Persist activities (Complete) | Versioned schema migration; persist, retrieve, paginate, and delete activity summaries; enforce deterministic duplicate detection and database uniqueness; preserve null/zero semantics |
| RP-04 | Activity history UI (Complete) | Provide Overview, Activities, and Import navigation; show persisted history with backend pagination and an activity detail view; preserve null versus zero metrics and display local activity/import timestamps; allow confirmed deletion with refresh and correct pagination; show true total count and five newest imports without inferring all-time aggregates; preserve local-only privacy and upload behavior |
| RP-05 | Authentication and isolation | Users can only access their own activities; protect uploads and reads |
| RP-06 | FIT and TCX | Normalize formats into the same domain model; tests for missing sensors |
| RP-07 | Historical trends | Compare weekly mileage and pace using documented definitions |
| RP-08 | AI insights | Ground responses in calculated metrics; evaluate factual accuracy and avoid medical advice |

Before exposing the application publicly, complete authentication and authorization, data deletion and privacy review.
