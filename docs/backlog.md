# Initial backlog

| ID | Story | Acceptance criteria |
|---|---|---|
| RP-01 | Establish workspace | Web and API run locally; analytics tests run in CI |
| RP-02 | Import GPX | Reject malformed or oversized XML; parse timestamps and coordinates; disable external entities; use synthetic fixtures |
| RP-03 | Persist activities | Migration and integration tests; duplicate imports handled; transactional writes |
| RP-04 | Activity dashboard | Show distance, elapsed duration and pace; handle missing metrics and empty states |
| RP-05 | Authentication and isolation | Users can only access their own activities; protect uploads and reads |
| RP-06 | FIT and TCX | Normalize formats into the same domain model; tests for missing sensors |
| RP-07 | Historical trends | Compare weekly mileage and pace using documented definitions |
| RP-08 | AI insights | Ground responses in calculated metrics; evaluate factual accuracy and avoid medical advice |

Before exposing the application publicly, complete authentication and authorization, data deletion and privacy review.
