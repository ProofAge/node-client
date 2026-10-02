# ProofAge Node Client — API contract for agents

This package wraps the ProofAge v1 HTTP API. Methods on `client.workspace()` and
`client.verifications(id)` return decoded JSON, typed by the interfaces in `src/types.ts`
(and re-exported from the package root). A machine-readable spec ships at `openapi.json`
(authoritative for endpoints and request bodies; it describes most response bodies too, and
where it does not, the response interfaces below are authoritative).

All requests send `X-API-Key` and `X-HMAC-Signature`. Request bodies use **snake_case** to
match the API. Responses are never wrapped in `data`.

Every request also identifies the SDK: `X-ProofAge-Sdk: node/<package version>` (wrapper
packages prepend their own `<name>/<version>` tokens via the `sdkTokens` option, outermost
first, space-separated; the `node/<version>` token is always last) and `User-Agent:
ProofAge-Node/<package version> (Node <runtime version>)` unless `userAgent` is set. Neither
header is signed.

`baseUrl` is the API **origin without the version**: `https://api.proofage.xyz` (the default).
The client appends `/{version}` (default `v1`) itself, so requests go to
`https://api.proofage.xyz/v1/...`. A trailing `/v1` on `baseUrl` (as in the OpenAPI `servers`
entry) is stripped; a value that is not an absolute http(s) URL throws at construction.

## Errors

Every non-2xx response throws. `AuthenticationError` (401) and `ValidationError` (422, with
`getErrors()` for field errors) extend `ProofAgeError`, which carries `statusCode`, `message`,
`code` (the API's machine-readable code, when sent), `errorData` and the raw `responseBody`.
The API uses four error body shapes; the client reads all of them:

- `{ error: { code, message } }` — most errors (401 auth, 429 `RATE_LIMIT`, submit 422, media download 404). `errorData` is the inner object.
- `{ code, message, ...extra }` — flat: `402 PAYMENT_METHOD_REQUIRED` (extra: `free_verifications_remaining`, `trial_ends_at`, `trial_active`) and media-quality rejections on upload (`422`, e.g. `FACE_NOT_FOUND`; `500 VALIDATION_SERVICE_UNAVAILABLE`). `errorData` is the whole body.
- `{ message, errors }` — request validation (`422`). `code` is undefined; `getErrors()` has the fields.
- `{ message }` — `403` (verification not in your workspace) and `404` (`Resource not found`).

A 2xx response with an empty body resolves to `null`; a non-empty 2xx body that is not JSON
throws `ProofAgeError` (almost always a `baseUrl` pointing at a website rather than the API).

Retries: GETs retry on 408, 429, 5xx, timeouts and network errors. POSTs retry **only** on 429
and on network errors raised before the request was sent (DNS failure, connection refused) —
never on 5xx or timeouts, where the server may already have created the verification or
stored the upload. A 429 waits for `Retry-After` when present, else `retryDelay × attempt`.

## Auth / HMAC

- `X-API-Key`: workspace API key (plaintext; the server SHA256-hashes it).
- `X-HMAC-Signature`: hex HMAC-SHA256 with the workspace secret key over a canonical string:
  - JSON / no-file requests: `METHOD + /{version}/{path} + rawJsonBody` (direct concatenation, no delimiter).
  - Multipart (file) requests: `METHOD/{version}/{path}\n{fields}\n{comma-joined sorted sha256(file) hashes}`,
    where `{fields}` is PHP `http_build_query(ksort($fields), '', '&', PHP_QUERY_RFC3986)` — keys
    sorted, values `rawurlencode`d (so `! ' ( ) *` are percent-encoded too). The server signs the
    text fields exactly as it receives them, so the client signs exactly what it sends: `null`/
    `undefined` fields are dropped, numbers are `String(n)`, booleans `"1"`/`"0"`, objects and
    arrays JSON strings. Golden vectors: `tests/fixtures/hmac-vectors.json`.

## Endpoints

### GET /workspace — `client.workspace().get()` → `WorkspaceInfo`
Request: none.
Response: `{ id: string, name: string, flow_type: string, mode: string, age_mode: string|null, age_threshold: number|null, verification_type: string, redirect_url: string|null, webhook_url: string|null, allow_expired_documents: boolean, allow_duplicate_accounts: boolean }`

### GET /consent — `client.workspace().getConsent()` → `ConsentInfo`
Request: none.
Response: `{ id: number, version: number, text_sha256: string, url: string }` (`version` is informational: accept consent with `id` and `text_sha256`)

### POST /verifications — `client.verifications().create(body)` → `CreatedVerification`
Request: `{ callback_url?: url(<=2048), external_id?: string(<=255), external_metadata?: object, metadata?: object }`. `external_id` and `callback_url` are kept only when the request is signed (the client signs every request).
Response (`201`): `{ id: string, external_id: string|null, external_metadata: object|null, redirect_url: string|null, status: string, reason: string|null, duplicate_check: DuplicateCheck, erasure: Erasure|null, consent_accepted_at: string|null, created_at: string, updated_at: string, url: string }` — `url` is the hosted session the person opens.
Errors: `402` flat `{ code: "PAYMENT_METHOD_REQUIRED", message, free_verifications_remaining, trial_ends_at, trial_active }`; `422` `{ message, errors }`.

- `DuplicateCheck`: `{ checked: boolean, duplicate_count: number, duplicates: [ { verification_id: string, external_id: string|null, similarity_score: number, verified_at: string|null } ] }` — always present.
- `Erasure`: `{ erased_at: string, scope: "personal_data", reason: string|null, requested_via: "customer"|"proofage"|"retention"|null }` — `null` until the verification's personal data is erased. `reason` is an erasure reason code (`data_subject_request`, `customer_request`, `retention_policy`, `test_data`, `other`) or null if unrecorded.

### GET /verifications/{verification} — `client.verifications(id).get()` / `client.verifications().find(id)` → `Verification`
Request: none.
Response: same as create **without** `url` (`duplicate_check` and `erasure` included).

### POST /verifications/{verification}/consent — `client.verifications(id).acceptConsent(body)` → `AcceptConsentResult`
Request: `{ consent_version_id: number, text_sha256: string(64 hex) }`: the `id` and `text_sha256` from `getConsent()`.
Response: `{ consent_version_id: number, consent_accepted_at: string }`

### POST /verifications/{verification}/media — `client.verifications(id).uploadMedia(payload)` (multipart) → `null`
Request (`UploadMediaPayload`): `{ file: Buffer|Uint8Array (image, <=10 MB; documents >=200px per edge), filename?: string, type: "selfie"|"document", side: "front"|"back" (required when type=document), document: "id"|"driver_license"|"passport"|"residence_permit" (required when type=document) }`. `null`/`undefined` fields are not sent.
Response: `200` with an **empty body**; the method resolves to `null`. Requires consent accepted first.
Errors: `422` flat `{ code, message }` when the image is rejected (e.g. `FACE_NOT_FOUND`), `422` `{ message, errors }` for invalid fields, `500` flat `{ code: "VALIDATION_SERVICE_UNAVAILABLE", message }`.

### POST /verifications/{verification}/submit — `client.verifications(id).submit()` → `null`
Request: none.
Response: `200` with an **empty body**; the method resolves to `null`. Error: `422 { error: { code, message } }` (e.g. `MISSING_REQUIRED_MEDIA`).

### GET /verifications/{verification}/document — `client.verifications(id).document()` → `VerificationDocument`
Request: none.
Response: `{ document: { type?: DocumentResultType|null, issuing_country?: string|null, issuing_subdivision?: string|null, fields: { first_name: string|null, middle_name?: string|null, last_name: string|null, date_of_birth: string|null, gender?: DocumentGender|null, nationality?: string|null, place_of_birth?: string|null, address?: string|null, document_number: string|null, issue_date?: string|null, expiry_date?: string|null } }, media: [ { id: string, type: "selfie"|"document_front"|"document_back", url: string|null } ], meta: { attempt_id: string|null } }`. `url` is the download endpoint for that media, null once it has been purged or is past retention.

Document semantics. `null` means the field was not read or is not printed on that document (a passport has no address, many cards print no place of birth, the German identity card prints no sex). `type` is an open enum (`passport`, `id`, `driver_license`, `residence_permit`, `other`): handle unknown values; `other` is declared and not yet produced; `id` is the same value the upload endpoint takes. `issuing_subdivision` is the state or province of issuance as a bare code (`FL` with `US`; up to three uppercase letters or digits) or `null`: it is `null` when `issuing_country` is, filled today for US driving licences and ID cards, present on every workspace, and kept after erasure. `issuing_country` and `nationality` are ISO 3166-1 alpha-2 (`XK` for Kosovo) and can differ, for example on a residence permit. `gender` is `F`, `M` or `X` (an open union); `X` means the document states that the sex is unspecified, and `gender` is `null` on a Mexican voter card or driving licence created before 20 August 2026 17:00 UTC. `date_of_birth`, `issue_date` and `expiry_date` are `YYYY-MM-DD`: a document that prints only the month or year of expiry reports the last day of that period, a partially printed birth or issue date is `null`, and a permanent document (for example `PERMANENTE`) has a `null` `expiry_date`. `place_of_birth` is the printed text. `address` is the printed text as read (trimmed, `null` when empty, not parsed, may contain line breaks). Age workspaces receive only `type`, `issuing_country` and `first_name`, `last_name`, `date_of_birth`, `document_number`; the other seven keys are absent, not `null`, so the typed shape marks them optional.

### GET /verifications/{verification}/media/{media} — `client.verifications(id).downloadMedia(mediaId)` / `downloadMediaTo(mediaId, path)`
Request: none. `{media}` is `media[].id` from document().
Response: the image bytes, `Content-Type` from the file (e.g. `image/jpeg`). `downloadMedia()` returns a web `ReadableStream<Uint8Array>`; `downloadMediaTo(mediaId, path)` streams to disk and returns the path. Check `media[].url` is not null before downloading — null means purged or past retention. The request sends `Accept: application/json, */*;q=0.8` so errors come back as JSON. Error: `404 { error: { code: "MEDIA_NOT_FOUND", message } }`. Downloads never retry an HTTP status, 429 included: run them from a queue and let its backoff own the wait.

### GET /verifications/{verification}/estimation — `client.verifications(id).estimation()` → `AgeEstimation`
Request: none.
Response: `{ verification_id: string, attempt_id: string|null, age_threshold: { minimum: number|null, passed: boolean|null, confidence: number|null }, gender: { value: 0|1|null, confidence: number|null }|null }` (gender value: 0=female, 1=male).

### POST /verifications/{verification}/blocked-face — `client.verifications(id).blockFace({ reason_code, reason })`
Request: `{ reason_code?: BlockFaceReasonCode, reason?: string(<=1000) }`.
Response: `204 No Content` (method resolves to `null`).

## Enums

- `status` (`VerificationStatus`): one of `created`, `started`, `submitted`, `resubmission_requested`, `approved`, `declined`, `abandoned`, `expired`, `review`, or `documents_required` (the last is surfaced from the latest attempt's state, not a verification status). The type is an open union: handle unknown values.
- `reason_code` (request field on `blockFace`, the `BlockFaceReasonCode` union / `BLOCK_FACE_REASON_CODES` array): `presentation_attack` (spoof: screen, print or mask), `fraudulent_document` (forged, edited, or not a real document), `scam_or_abuse` (identity may be genuine — blocked for behaviour on your platform), `underage`, `other` (explain in `reason`). Optional over the API, mandatory in the ProofAge consoles: send it whenever a person made the decision, or the block cannot be told apart from an automated one in reporting.
- `reason` (on `declined` / `resubmission_requested`): dotted codes from the server's reason catalog — illustrative examples: `aml.blocklist.face_match`, `document.face.mismatch`, `verification.age_threshold.failed`. Treat `reason` as an open string.

## Outbound webhook (ProofAge → your `callback_url` / workspace webhook URL)

Headers: `X-Auth-Client` (api key), `X-Timestamp` (unix seconds), `X-HMAC-Signature`
(= hex HMAC-SHA256 of `{timestamp}.{rawJsonBody}` with the active secret key),
`X-ProofAge-Webhook-Delivery-Id` (the delivery id: the same on every automatic retry of one
delivery, a new one on a manual resend — de-duplicate on it). Verify with
the package's `webhookHandler` / `verifyWebhookSignature` / `handleWebhook` helpers. The body
is typed as `WebhookPayload`:

```
{
  "verification_id": string,
  "status": string,
  "external_id": string|null,                  // always present
  "external_metadata": object|null,            // always present
  "reason": string|null,                       // always present; a code only on resubmission_requested / declined
  "timestamp": string (ISO8601),
  "document"?: { "type"?: ..., "issuing_country"?: string|null, "fields": {...} },  // same object as document() without media; see below
  "duplicate_detected"?: true,                 // the three duplicate_* keys appear together, only when a duplicate face was found
  "duplicate_count"?: number,
  "duplicate_of"?: { "verification_id": string, "external_id": string|null },
  "fingerprint_signals"?: object,              // ip_address, ip_country_code, ip_timezone, device_timezone, ... when collected
  "manual_moderation"?: {                      // after a console approve/decline
    "action": "approve"|"decline", "reason": string, "source": "tenant_admin"|"landlord_admin",
    "performed_by": { "id": number, "name": string|null, "email": string|null, "role": string|null },
    "source_status"?: string, "source_reason"?: string|null   // approve only
  }
}
```

`document` is on every decision webhook, whatever the status: the same object `document()` returns
(`type`, `issuing_country`, `fields`), without `media` and `meta`, typed as
`VerificationDocument['document']` and optional because a body sent before it existed, or the body of
a retry after erasure, may lack it. KYC workspaces receive eleven `fields`; age workspaces receive
`first_name`, `last_name`, `date_of_birth` and `document_number` only, the other seven keys being
absent. `null` means not read, not printed, or no document read at all (an age estimate without an ID,
a test workspace, a wallet check); `document` itself is never null on a current body. A resend and a
manual retry carry the document as it is now, an automatic retry the body as first sent; after
erasure only `type` and `issuing_country` remain. The body carries names: verify the signature over
the raw bytes before parsing, and do not log it.

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
