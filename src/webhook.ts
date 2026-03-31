import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError, type WebhookVerificationErrorCode } from './errors.js';

export interface VerifyWebhookSignatureInput {
  /** Raw request body string (must match bytes ProofAge signed). */
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | number | null | undefined;
  authClient: string | null | undefined;
  secretKey: string | undefined;
  apiKey: string | undefined;
  tolerance?: number;
}

function throwErr(code: WebhookVerificationErrorCode, message: string, status = 401): never {
  throw new WebhookVerificationError(code, message, status);
}

/**
 * Verify ProofAge webhook HMAC (same algorithm as Laravel `WebhookSignatureVerifier` + middleware checks).
 * Use the raw body as received (e.g. `await request.text()` in Next.js).
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): void {
  const {
    rawBody,
    signature,
    timestamp,
    authClient,
    secretKey,
    apiKey,
    tolerance = 300,
  } = input;

  if (!signature) {
    throwErr('MISSING_SIGNATURE', 'X-HMAC-Signature header is required');
  }
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    throwErr('MISSING_TIMESTAMP', 'X-Timestamp header is required');
  }
  if (!authClient) {
    throwErr('MISSING_AUTH_CLIENT', 'X-Auth-Client header is required');
  }
  if (!secretKey || !apiKey) {
    throwErr('CONFIGURATION_ERROR', 'Webhook verification requires apiKey and secretKey', 418);
  }

  if (authClient !== apiKey) {
    throwErr('INVALID_AUTH_CLIENT', 'X-Auth-Client header is invalid');
  }

  const ts = typeof timestamp === 'string' ? Number.parseInt(timestamp, 10) : timestamp;
  if (!Number.isFinite(ts)) {
    throwErr('MISSING_TIMESTAMP', 'X-Timestamp header is invalid');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > tolerance) {
    throwErr('TIMESTAMP_TOO_OLD', 'Timestamp is outside allowed tolerance');
  }

  const expected = createHmac('sha256', secretKey)
    .update(`${ts}.${rawBody}`, 'utf8')
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throwErr('INVALID_SIGNATURE', 'HMAC signature is invalid');
  }
}

/**
 * Generate webhook signature (for tests or outbound mocks). Matches `SendWebhook::generateSignature` in ProofAge.
 */
export function generateWebhookSignature(payload: Record<string, unknown>, secret: string, timestamp: number): string {
  const jsonPayload = JSON.stringify(payload);
  const signaturePayload = `${timestamp}.${jsonPayload}`;
  return createHmac('sha256', secret).update(signaturePayload, 'utf8').digest('hex');
}
