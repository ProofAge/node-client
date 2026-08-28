# ProofAge Node Client — API contract for agents

This package wraps the ProofAge v1 HTTP API. Methods on `client.workspace()` and
`client.verifications(id)` return decoded JSON, typed by the interfaces in `src/types.ts`
(and re-exported from the package root). A machine-readable spec ships at `openapi.json`
(authoritative for endpoints + request bodies; response schemas there are incomplete by
generator limitation — the response interfaces below are authoritative for responses).

All requests send `X-API-Key` and `X-HMAC-Signature`. Base URL is `{baseUrl}/{version}`
(defaults `https://api.proofage.xyz/v1`). Request bodies use **snake_case** to match the API.

## Auth / HMAC

- `X-API-Key`: workspace API key (plaintext; the server SHA256-hashes it).
- `X-HMAC-Signature`: hex HMAC-SHA256 with the workspace secret key over a canonical string:
  - JSON / no-file requests: `METHOD + /{version}/{path} + rawJsonBody` (direct concatenation, no delimiter).
  - Multipart (file) requests: `METHOD/{version}/{path}\n{sorted fields as RFC3986 query}\n{comma-joined sorted sha256(file) hashes}`.

## Endpoints

### GET /workspace — `client.workspace().get()` → `WorkspaceInfo`
Request: none.
Response: `{ id: string, name: string, flow_type: string, mode: string, age_mode: string|null, age_threshold: number|null, verification_type: string, redirect_url: string|null, webhook_url: string|null, allow_expired_documents: boolean, allow_duplicate_accounts: boolean }`

### GET /consent — `client.workspace().getConsent()` → `ConsentInfo`
Request: none.
Response: `{ id: number, version: string, text_sha256: string, url: string }`

### POST /verifications — `client.verifications().create(body)` → `CreatedVerification`
Request: `{ fingerprint?: string(64), callback_url?: url(<=2048), external_id?: string(<=255), external_metadata?: object, metadata?: object }`
Response: `{ id, external_id, external_metadata, redirect_url, status, reason, consent_accepted_at, created_at, updated_at, url }`
Errors: `402` `{ code: "PAYMENT_METHOD_REQUIRED", message, free_verifications_remaining, trial_ends_at, trial_active }`.

### GET /verifications/{verification} — `client.verifications(id).get()` / `client.verifications().find(id)` → `Verification`
Request: none.
Response: same as create **without** `url`.

### POST /verifications/{verification}/consent — `client.verifications(id).acceptConsent(body)` → `AcceptConsentResult`
Request: `{ consent_version_id: number, text_sha256: string(64 hex) }`
Response: `{ consent_version_id: number, consent_accepted_at: string }`

### POST /verifications/{verification}/media — `client.verifications(id).uploadMedia({ type, file, filename })` (multipart) → `MessageResult`
Request: `{ file: Buffer|Uint8Array, type: "selfie"|"liveness_selfie"|"document", side?: "front"|"back" (req. if type=document), document?: "id"|"driver_license"|"passport"|"residence_permit" (req. if type=document), fingerprint?: string(64), head_turn_step?: number(0..10), capture_resolution?: json-string, device_info?: json-string }`
Response: `{ message: string }`. Requires consent accepted first.

### POST /verifications/{verification}/submit — `client.verifications(id).submit()` → `MessageResult`
Request: none.
Response: `{ message: string }`. Error: `422 { error: { code, message } }`.

### GET /verifications/{verification}/document — `client.verifications(id).document()` → `VerificationDocument`
Request: none.
Response: `{ document: { fields: { first_name: string|null, last_name: string|null, date_of_birth: string|null (YYYY-MM-DD), document_number: string|null } }, media: [ { id: string, type: "selfie"|"document_front"|"document_back", url: string|null } ], meta: { attempt_id: string|null } }`. `url` is the download endpoint for that media, null once it has been purged or is past retention.

### GET /verifications/{verification}/media/{media} — `proofage.verifications(id).downloadMedia(mediaId)`
Request: none. `{media}` is `media[].id` from document().
Response: the image bytes, `Content-Type` from the file (e.g. `image/jpeg`). `downloadMedia()` returns a web `ReadableStream<Uint8Array>`; `downloadMediaTo(mediaId, path)` streams to disk and returns the path. Check `media[].url` is not null before downloading — null means purged or past retention. Error: `404 { error: { code: "MEDIA_NOT_FOUND", message } }`. Downloads never retry an HTTP status, 429 included: run them from a queue and let its backoff own the wait.

### GET /verifications/{verification}/estimation — `client.verifications(id).estimation()` → `AgeEstimation`
Request: none.
Response: `{ verification_id: string, attempt_id: string|null, age_threshold: { minimum: number|null, passed: boolean|null, confidence: number|null }, gender: { value: 0|1|null, confidence: number|null }|null }` (gender value: 0=female, 1=male).

### POST /verifications/{verification}/blocked-face — `client.verifications(id).blockFace({ reason })`
Request: `{ reason?: string(<=1000) }`.
Response: `204 No Content` (method resolves to `null`).

## Enums

- `status`: one of `created`, `started`, `submitted`, `resubmission_requested`, `approved`, `declined`, `abandoned`, `expired`, `review`, or `documents_required` (the last is surfaced from the latest attempt's state, not a verification status). Treat `status` as an open string.
- `reason` (on `declined` / `resubmission_requested`): dotted codes from the server's reason catalog — illustrative examples: `aml.blocklist.face_match`, `document.face.mismatch`, `verification.age_threshold.failed`. Treat `reason` as an open string.

## Outbound webhook (ProofAge → your `callback_url` / workspace webhook URL)

Headers: `X-Auth-Client` (api key), `X-Timestamp` (unix seconds), `X-HMAC-Signature`
(= hex HMAC-SHA256 of `{timestamp}.{rawJsonBody}` with the active secret key). Verify with
the package's `webhookHandler` / `verifyWebhookSignature` / `handleWebhook` helpers. The body
is typed as `WebhookPayload`:

```
{
  "verification_id": string,
  "status": string,
  "external_id": string|null,
  "external_metadata": object|null,
  "reason": string|null,                       // only on resubmission_requested / declined
  "timestamp": string (ISO8601),
  "duplicate_detected"?: true,
  "duplicate_of"?: { "verification_id": string, "external_id": string|null }
}
```

## Keeping this in sync

This contract is drift-tested against `openapi.json` via `tests/api-contract.test.ts`, so it
stays aligned with the API. Maintainers refreshing it after an API change: see the SDK
contract-sync runbook in the ProofAge app repo (the single source of truth for all SDKs).

## Releasing (maintainers)

When preparing a release for this package:

- Update the version with `npm version <patch|minor|major> --no-git-tag-version` so both `package.json` and `package-lock.json` stay in sync.
- Run `npm test` and `npm run build` before claiming the release is ready.
- Commit the version bump and code changes together when they are part of the same release.
- Create a git tag that matches the package version, prefixed with `v` (for example, package `0.1.1` -> tag `v0.1.1`).
- Push both the commit and the tag. The npm publish workflow is triggered by `v*` tags.
- Do not run `npm publish` manually unless explicitly requested; the GitHub Actions Trusted Publishing workflow should publish releases.

If npm reports package metadata auto-fixes, run `npm pkg fix`, review the diff, and commit any resulting `package.json` or lockfile changes before tagging.
