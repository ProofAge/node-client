# @proofage/node

Node.js client for the [ProofAge](https://proofage.xyz) API with **HMAC request signing** and **webhook signature verification**. Mirrors the behavior of [`proofage/laravel-client`](https://github.com/proofage/proofage-laravel-client).

## Requirements

- Node.js 18+

## Installation

```bash
npm install @proofage/node
```

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `apiKey` | Yes | — | Workspace API key (`X-API-Key`) |
| `secretKey` | Yes | — | Secret key for HMAC signing |
| `baseUrl` | No | `https://api.proofage.xyz` | API base URL |
| `version` | No | `v1` | API version path segment |
| `timeout` | No | `30000` | Request timeout (ms) |
| `retryAttempts` | No | `3` | Retries for transient failures |
| `retryDelay` | No | `1000` | Base delay between retries (ms) |

## Usage

```typescript
import { ProofAgeClient } from '@proofage/node';

const client = new ProofAgeClient({
  apiKey: process.env.PROOFAGE_API_KEY!,
  secretKey: process.env.PROOFAGE_SECRET_KEY!,
  baseUrl: process.env.PROOFAGE_BASE_URL ?? 'https://api.proofage.xyz',
});

const workspace = await client.workspace().get();
const consent = await client.workspace().getConsent();

const verification = await client.verifications().create({
  callback_url: 'https://your-app.com/api/webhooks/proofage',
  metadata: { order_id: '123' },
});

const status = await client.verifications(verification!.id as string).get();
```

### API methods

- `client.workspace().get()` — `GET /v1/workspace`
- `client.workspace().getConsent()` — `GET /v1/consent`
- `client.verifications().create(body)` — `POST /v1/verifications`
- `client.verifications(id).find(id)` / `.get()` — `GET /v1/verifications/{id}`
- `client.verifications(id).acceptConsent(body)` — `POST /v1/verifications/{id}/consent`
- `client.verifications(id).uploadMedia({ type, file, filename })` — `POST /v1/verifications/{id}/media` (multipart)
- `client.verifications(id).submit()` — `POST /v1/verifications/{id}/submit`

Request bodies use **snake_case** keys to match the ProofAge API.

## Webhooks

ProofAge sends `POST` requests with:

| Header | Description |
|--------|-------------|
| `X-Auth-Client` | Your workspace API key |
| `X-HMAC-Signature` | HMAC-SHA256 hex digest of `{timestamp}.{rawJsonBody}` |
| `X-Timestamp` | Unix timestamp (seconds) |

Verify the **raw body** string (e.g. `await request.text()` in Next.js App Router) before parsing JSON:

```typescript
import { verifyWebhookSignature } from '@proofage/node';

export async function POST(request: Request) {
  const rawBody = await request.text();

  verifyWebhookSignature({
    rawBody,
    signature: request.headers.get('x-hmac-signature'),
    timestamp: request.headers.get('x-timestamp'),
    authClient: request.headers.get('x-auth-client'),
    secretKey: process.env.PROOFAGE_SECRET_KEY,
    apiKey: process.env.PROOFAGE_API_KEY,
    tolerance: 300,
  });

  const payload = JSON.parse(rawBody);
  // Your business logic: update order, grant access, etc.

  return Response.json({ received: true });
}
```

On failure, `verifyWebhookSignature` throws `WebhookVerificationError` with a `code` suitable for logging.

## Errors

- `ProofAgeError` — generic API error (includes `statusCode` and parsed `error` object when present)
- `AuthenticationError` — HTTP 401
- `ValidationError` — HTTP 422 (`getErrors()` returns field errors)
- `WebhookVerificationError` — invalid or missing webhook signature / headers

## License

MIT
