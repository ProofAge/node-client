# ProofAge Node.js Client — Age Verification for Node.js

**Platform:** https://proofage.xyz | **npm:** https://www.npmjs.com/package/@proofage/node

A Node.js client for the [ProofAge](https://proofage.xyz) API with **HMAC request signing** and **webhook signature verification**.

## About ProofAge

ProofAge is an online age verification platform enabling websites to confirm users meet minimum age requirements through a hosted, privacy-focused KYC process — without server-side document handling. It supports alcohol/tobacco/cannabis commerce, adult content platforms, gambling sites, and age-restricted subscriptions.

This package provides a first-class Node.js integration: auto-configuration from environment variables, HMAC-signed API calls, a drop-in webhook handler for Next.js App Router, Hono, Cloudflare Workers, and any framework with a standard `Request`, plus a CLI verification command.

## Requirements

- Node.js 22+ (see `engines` in package.json)

## Installation

```bash
npm install @proofage/node
```

## Quick Start

Set your environment variables:

```bash
PROOFAGE_API_KEY=pk_live_...
PROOFAGE_SECRET_KEY=sk_live_...
# Optional:
# PROOFAGE_BASE_URL=https://api.proofage.xyz
# PROOFAGE_WEBHOOK_TOLERANCE=300
```

Create a client — keys resolve from env automatically:

```typescript
import { ProofAgeClient } from '@proofage/node';

const client = new ProofAgeClient();

const workspace = await client.workspace().get();

const verification = await client.verifications().create({
  callback_url: 'https://your-app.com/verify/complete',  // optional
  metadata: { order_id: '123' },
});
```

Or pass config explicitly:

```typescript
const client = new ProofAgeClient({
  apiKey: 'pk_live_...',
  secretKey: 'sk_live_...',
});
```

## Configuration

All options fall back to environment variables, then to defaults.

| Option | Env var | Default | Description |
|--------|---------|---------|-------------|
| `apiKey` | `PROOFAGE_API_KEY` | — | Workspace API key |
| `secretKey` | `PROOFAGE_SECRET_KEY` | — | Secret key for HMAC signing |
| `baseUrl` | `PROOFAGE_BASE_URL` | `https://api.proofage.xyz` | API **origin, without `/v1`** — the client appends the version. A trailing `/v1` is stripped. |
| `version` | `PROOFAGE_VERSION` | `v1` | API version path segment |
| `timeout` | `PROOFAGE_TIMEOUT` | `30000` | Request timeout (ms) |
| `retryAttempts` | `PROOFAGE_RETRY_ATTEMPTS` | `3` | Total attempts for transient failures (see below) |
| `retryDelay` | `PROOFAGE_RETRY_DELAY` | `1000` | Base delay between retries (ms), multiplied by the attempt number |
| `sdkTokens` | — | `[]` | For wrapper packages: `<name>/<version>` tokens prepended to `X-ProofAge-Sdk` (see below) |
| `userAgent` | — | `ProofAge-Node/<version> (Node <runtime>)` | Overrides the `User-Agent` header |

**Retries.** GET requests retry on 408, 429, 5xx, timeouts and network errors. POST and DELETE
requests (create, consent, upload, submit, block, test outcome, webhook subscriptions) retry **only** on 429 and on network errors raised
before the request was sent (DNS failure, connection refused) — never on a 5xx or a timeout,
where the server may already have acted, so a retry could create a second verification. A 429
waits for the API's `Retry-After`. Media downloads never retry an HTTP status.

**SDK identification.** Every request carries `X-ProofAge-Sdk: node/<package version>` and
`User-Agent: ProofAge-Node/<package version> (Node <runtime version>)`, so ProofAge support can
tell which client and version sent it. Neither header is part of the HMAC signature. A package
that wraps this client names itself with `sdkTokens`, outermost first; the client's own token
always stays last:

```typescript
const client = new ProofAgeClient({ sdkTokens: ['shopify-app/1.4.0'] });
// X-ProofAge-Sdk: shopify-app/1.4.0 node/0.6.0
```

## API Methods

- `client.workspace().get()` — `GET /v1/workspace`
- `client.workspace().getConsent()` — `GET /v1/consent`
- `client.verifications().create(body)` — `POST /v1/verifications`
- `client.verifications().list(params)` — `GET /v1/verifications` (filters and cursor paging; resolves to `{ data, next_cursor }`)
- `client.verifications(id).get()` / `client.verifications().find(id)` — `GET /v1/verifications/{id}`
- `client.verifications(id).acceptConsent(body)` — `POST /v1/verifications/{id}/consent`
- `client.verifications(id).uploadMedia(payload)` — `POST /v1/verifications/{id}/media` (multipart; resolves to `null`)
- `client.verifications(id).submit()` — `POST /v1/verifications/{id}/submit` (resolves to `null`)
- `client.verifications(id).document()` — `GET /v1/verifications/{id}/document`
- `client.verifications(id).downloadMedia(mediaId)` — `GET /v1/verifications/{id}/media/{mediaId}` (a web `ReadableStream`)
- `client.verifications(id).downloadMediaTo(mediaId, path)` — same, streamed to a file; resolves to the path
- `client.verifications(id).estimation()` — `GET /v1/verifications/{id}/estimation`
- `client.verifications(id).blockFace({ reason_code, reason })` — `POST /v1/verifications/{id}/blocked-face`
- `client.verifications(id).setTestOutcome({ status, reason })` — `POST /v1/verifications/{id}/test-outcome` (test workspaces only)
- `client.webhookSubscriptions().create(body)` — `POST /v1/webhook-subscriptions`
- `client.webhookSubscriptions().list()` — `GET /v1/webhook-subscriptions`
- `client.webhookSubscriptions().delete(id)` — `DELETE /v1/webhook-subscriptions/{id}` (resolves to `null`)

Request bodies use **snake_case** keys to match the ProofAge API. `callback_url` is optional — if omitted, the verification result is available via polling or webhook.

### Listing verifications

Newest first, filtered by `status` and `external_id`, a page of `limit` (1-100, default 20) at a time:

```typescript
let cursor: string | undefined;
do {
  const page = (await client.verifications().list({ status: ['approved', 'declined'], limit: 100, cursor }))!;
  for (const verification of page.data) {
    console.log(verification.id, verification.status);
  }
  cursor = page.next_cursor ?? undefined; // null on the last page
} while (cursor);
```

Send the same filters with every `cursor`. The query string is signed exactly as the API
normalises it (sorted keys, RFC 3986 encoding), so nothing needs to be encoded by hand.

### Testing each outcome

In a **test workspace**, finish a verification with the outcome you want to test, without going
through the widget. The decision webhooks are sent as for a real decision:

```typescript
const { id } = (await client.verifications().create({ external_id: 'user-42' }))!;
const verification = await client.verifications(id).setTestOutcome({ status: 'declined' });
// status: 'approved' | 'declined' | 'review' | 'resubmission_requested'
```

A live workspace throws a `ProofAgeError` with `code` `TEST_WORKSPACE_ONLY`; a verification that
is already final throws a `ValidationError` with `code` `INVALID_STATUS`.

### Webhook subscriptions

Subscribe extra URLs to the decision webhooks, beside the workspace webhook URL set in the console
(REST hooks, as Zapier uses them). A workspace can have up to 50.

```typescript
const subscription = (await client.webhookSubscriptions().create({
  url: 'https://example.com/proofage/webhook',
  statuses: ['approved', 'declined'], // omit or null for every decision status
  include_document_data: false,       // the default: no document, fingerprint_signals or performed_by
}))!;

const { data } = (await client.webhookSubscriptions().list())!;

await client.webhookSubscriptions().delete(subscription.id);
```

Deliveries have the same body, headers and signature as the workspace webhook (verify them with
the helpers below), carry only `status.updated` events, and leave out the personal data unless
`include_document_data` is true. A delivery answered with `410 Gone` deletes the subscription. A
51st subscription throws a `ValidationError` with `code` `WEBHOOK_SUBSCRIPTION_LIMIT`.

### Server-side capture flow

When your backend collects the images itself instead of sending the person to the hosted `url`:

```typescript
import { readFile } from 'node:fs/promises';

const { id } = (await client.verifications().create({ external_id: 'user-42' }))!;
const verification = client.verifications(id);

const consent = (await client.workspace().getConsent())!;
await verification.acceptConsent({
  consent_version_id: consent.id,
  text_sha256: consent.text_sha256,
});

await verification.uploadMedia({ type: 'selfie', file: await readFile('selfie.jpg'), filename: 'selfie.jpg' });
await verification.uploadMedia({
  type: 'document',
  side: 'front',            // 'front' | 'back'
  document: 'passport',     // 'id' | 'driver_license' | 'passport' | 'residence_permit'
  file: await readFile('passport.jpg'),
  filename: 'passport.jpg',
});

await verification.submit();
```

A rejected image throws a `ValidationError` whose `code` says why (e.g. `FACE_NOT_FOUND`).

### Downloading media

```typescript
const result = await client.verifications(id).document();
for (const media of result?.media ?? []) {
  if (media.url === null) continue; // purged or past retention
  await client.verifications(id).downloadMediaTo(media.id, `./${media.type}.jpg`);
}
```

### Blocking a face

```typescript
await client.verifications(id).blockFace({
  reason_code: 'presentation_attack', // see BLOCK_FACE_REASON_CODES
  reason: 'Selfie was a photo of a screen',
});
```

Send `reason_code` whenever a person made the decision; blocklist reporting counts it.

Every method is fully typed (see `src/types.ts` / the package's type definitions), and the exact request/response shape of each endpoint is documented in `AGENTS.md` and the bundled `openapi.json`.

## Webhooks

ProofAge sends `POST` requests with HMAC headers:

| Header | Description |
|--------|-------------|
| `X-Auth-Client` | Your workspace API key |
| `X-HMAC-Signature` | HMAC-SHA256 hex digest of `{timestamp}.{rawJsonBody}` |
| `X-Timestamp` | Unix timestamp (seconds) |
| `X-ProofAge-Webhook-Delivery-Id` | Delivery id — the same on every automatic retry of one delivery, so use it to de-duplicate (a manual resend from the console gets a new id) |

### Drop-in handler (recommended)

One-liner for Next.js App Router, Hono, Cloudflare Workers, or any framework with a standard `Request`:

```typescript
import { webhookHandler } from '@proofage/node';

// Keys and tolerance resolve from env automatically
export const POST = webhookHandler(async (payload) => {
  // Read `event` first. An absent `event` means `status.updated`.
  if (payload.event === 'data.updated') {
    // Someone corrected document fields: `payload.document` has the new values and
    // `payload.changed_fields` the names. The status is unchanged, so this is not a decision.
    return;
  }
  console.log(payload.verification_id, payload.status);
  // your business logic: update DB, send email, etc.
});
```

Returns `200` on success, `401` on invalid signature, `400` on invalid JSON, `500` if your callback throws.

### Manual verification

For full control or non-standard frameworks:

```typescript
import { verifyWebhookSignature } from '@proofage/node';

const rawBody = await request.text();

verifyWebhookSignature({
  rawBody,
  signature: request.headers.get('x-hmac-signature'),
  timestamp: request.headers.get('x-timestamp'),
  authClient: request.headers.get('x-auth-client'),
  // apiKey and secretKey resolve from env if omitted
});

const payload = JSON.parse(rawBody);
```

### Mid-level helper

`handleWebhook()` verifies + parses in one call, returns a result object:

```typescript
import { handleWebhook } from '@proofage/node';

const { verified, payload, error } = await handleWebhook(request);
if (!verified) {
  return new Response(null, { status: 401 });
}
// payload is typed as WebhookPayload
```

## CLI

Verify your setup from the terminal:

```bash
npx @proofage/node verify-setup
```

Reads `PROOFAGE_API_KEY`, `PROOFAGE_SECRET_KEY`, and `PROOFAGE_BASE_URL` from `.env.local` / `.env` automatically. Auto-skips TLS verification for local dev domains (`.test`, `.local`, `localhost`).

## Errors

- `ProofAgeError` — any API error: `statusCode`, `message`, `code` (the API's error code, e.g. `PAYMENT_METHOD_REQUIRED`, when sent), `errorData` (the parsed error detail — for a 402 it includes `free_verifications_remaining`, `trial_ends_at`, `trial_active`) and `responseBody`. Also thrown when a 2xx response is not JSON, which usually means `baseUrl` is wrong.
- `AuthenticationError` — HTTP 401
- `ValidationError` — HTTP 422 (`getErrors()` returns field errors; `code` is set for image rejections such as `FACE_NOT_FOUND`)
- `WebhookVerificationError` — invalid or missing webhook signature / headers

## Additional Resources

- **Platform:** https://proofage.xyz
- **Live Demo:** https://demo.proofage.xyz
- **Laravel Package:** `proofage/laravel-client` on Packagist

### Integrations for other platforms

| Platform | Repository | Use-case |
|---|---|---|
| **Node.js** | this repo | Node.js age verification client — HMAC-signed API calls, webhook verification for Express, Hono, Next.js and other Node.js frameworks |
| **WordPress** | [ProofAge/wordpress-plugin](https://github.com/ProofAge/wordpress-plugin) | Age gate plugin for WordPress — WooCommerce age verification, age-restricted pages, adult content gating |
| **Laravel** | [ProofAge/laravel-client](https://github.com/ProofAge/laravel-client) | Laravel age verification client — HMAC-signed API calls, webhook handling, middleware for age-restricted routes |
| **Next.js** | [ProofAge/demo](https://github.com/ProofAge/demo) | Full-stack age verification demo with JS SDK, server routes, and webhook receiver |

## License

MIT
