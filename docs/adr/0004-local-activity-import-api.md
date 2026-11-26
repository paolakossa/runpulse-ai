# ADR 0004: Local-only GPX activity import API

Status: Accepted for RP-02 implementation; pending code review

## Context

RP-02 already provides a secure GPX parser, a normalized activity model and a deterministic analytics engine. The API needs to expose them without persisting personal location or health data. The parser is synchronous and retains input and normalized samples in memory; an HTTP layer must bound work before Multer buffers the upload. ADR 0002 owns XML and parser budgets; ADR 0003 owns metric definitions.

## Decision

Add `POST /activities/import` as a thin NestJS controller over an application service. The service passes the uploaded bytes to `parseGpx`, calls `calculateActivityMetrics`, and projects only summary fields. The response includes global start/end timestamps, segment and point counts, metrics, and coverage. Unavailable metrics remain `null`. It never includes GPS coordinates, the uploaded filename or file contents. Imports are ephemeral; no database, temporary-file storage or background job is introduced.

The endpoint accepts exactly one multipart file named `file`. It classifies content through the GPX parser rather than trusting MIME type or extension, and recognizes a FIT signature as unsupported. UTF-8 XML 1.0 is accepted, including a UTF-8 BOM; invalid UTF-8 or conflicting XML declarations are rejected.

## Security and resource budgets

- Multer memory storage has a 10 MiB inclusive file limit, matching the parser. The streaming file-size limit applies before the complete upload is buffered.
- Multipart limits allow one file, one total part and zero text fields. Header pairs and field-name length are also bounded. No disk storage is configured.
- Admission middleware allows one in-flight import per API process before multipart parsing/buffering. Saturated requests receive a sanitized `429` and do not acquire or release the active permit.
- The receive-body deadline is 60 seconds by default, with a 120-second maximum enforced by module configuration. Expired requests receive a sanitized `408` and are terminated after the response. Permit cleanup is idempotent and covers normal completion, parser failure, timeout and client abort.
- The request deadline only covers body receipt. Synchronous XML parsing and analytics block the Node event loop and cannot be interrupted by that timer. Byte, XML complexity and concurrency limits bound exposure but are not a strict heap or CPU guarantee. Reassess worker isolation or queues only with measured need.
- Errors use a stable `{ statusCode, code, message }` shape. Messages and logs must not contain XML, locations, filenames, stack traces or personal data. Unexpected failures are logged with a generic message and return `500`.
- The API process binds to `127.0.0.1`; CORS remains disabled because it is not required for this endpoint. Do not bind to a public or shared network interface until authentication, authorization and user data isolation are implemented.
- Tests use synthetic GPX fixtures only. Never commit credentials, real activity files or production activity data.

## HTTP contract

| Status | Meaning |
|---:|---|
| 200 | Import and analysis succeeded. |
| 400 | Missing/empty file, invalid multipart request or invalid GPX. |
| 408 | Upload body did not complete before the receive deadline. |
| 413 | File exceeds 10 MiB. |
| 415 | Unsupported activity format. |
| 429 | The process already has an import in flight. |
| 500 | Unexpected failure, returned without internal details. |

This is a local development capability, not a production security boundary. It does not persist data, authenticate callers, enforce per-user quotas or provide multi-process/global concurrency coordination.
