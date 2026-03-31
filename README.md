# @proofage/node

Node.js client for the [ProofAge](https://proofage.xyz) API with **HMAC request signing** and **webhook signature verification**.

## Requirements

- Node.js 18+

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
| `baseUrl` | `PROOFAGE_BASE_URL` | `https://api.proofage.xyz` | API base URL |
| `version` | `PROOFAGE_VERSION` | `v1` | API version path segment |
| `timeout` | `PROOFAGE_TIMEOUT` | `30000` | Request timeout (ms) |
| `retryAttempts` | `PROOFAGE_RETRY_ATTEMPTS` | `3` | Retries for transient failures |
| `retryDelay` | `PROOFAGE_RETRY_DELAY` | `1000` | Base delay between retries (ms) |

## API Methods

- `client.workspace().get()` — `GET /v1/workspace`
- `client.workspace().getConsent()` — `GET /v1/consent`
- `client.verifications().create(body)` — `POST /v1/verifications`
- `client.verifications(id).get()` — `GET /v1/verifications/{id}`
- `client.verifications(id).acceptConsent(body)` — `POST /v1/verifications/{id}/consent`
- `client.verifications(id).uploadMedia({ type, file, filename })` — `POST /v1/verifications/{id}/media` (multipart)
- `client.verifications(id).submit()` — `POST /v1/verifications/{id}/submit`

Request bodies use **snake_case** keys to match the ProofAge API. `callback_url` is optional — if omitted, the verification result is available via polling or webhook.

## Webhooks

ProofAge sends `POST` requests with HMAC headers:

| Header | Description |
|--------|-------------|
| `X-Auth-Client` | Your workspace API key |
| `X-HMAC-Signature` | HMAC-SHA256 hex digest of `{timestamp}.{rawJsonBody}` |
| `X-Timestamp` | Unix timestamp (seconds) |

### Drop-in handler (recommended)

One-liner for Next.js App Router, Hono, Cloudflare Workers, or any framework with a standard `Request`:

```typescript
import { webhookHandler } from '@proofage/node';

// Keys and tolerance resolve from env automatically
export const POST = webhookHandler(async (payload) => {
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

- `ProofAgeError` — generic API error (includes `statusCode` and parsed `error` object when present)
- `AuthenticationError` — HTTP 401
- `ValidationError` — HTTP 422 (`getErrors()` returns field errors)
- `WebhookVerificationError` — invalid or missing webhook signature / headers

## License

MIT
