import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError, type WebhookVerificationErrorCode } from './errors.js';
import type { WebhookPayload } from './types.js';

function envStr(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[key] : undefined;
}

function envInt(key: string): number | undefined {
  const v = envStr(key);
  if (v === undefined || v === '') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export interface VerifyWebhookSignatureInput {
  /** Raw request body string (must match bytes ProofAge signed). */
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | number | null | undefined;
  authClient: string | null | undefined;
  /** Falls back to PROOFAGE_SECRET_KEY env var. */
  secretKey?: string | undefined;
  /** Falls back to PROOFAGE_API_KEY env var. */
  apiKey?: string | undefined;
  /** Seconds. Falls back to PROOFAGE_WEBHOOK_TOLERANCE env var, then 300. */
  tolerance?: number;
}

function throwErr(code: WebhookVerificationErrorCode, message: string, status = 401): never {
  throw new WebhookVerificationError(code, message, status);
}

function generateExpectedSignature(payload: string, timestamp: number, secretKey: string): string {
  return createHmac('sha256', secretKey)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
}

function signaturesMatch(signature: string, expected: string): boolean {
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');

  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

function canonicalizeJsonPayload(payload: string): string | null {
  if (payload === '') {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(payload));
  } catch {
    return null;
  }
}

/**
 * Verify ProofAge webhook HMAC (same algorithm as Laravel `WebhookSignatureVerifier` + middleware checks).
 * Keys and tolerance resolve from process.env when not provided — same env names as Laravel package.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): void {
  const {
    rawBody,
    signature,
    timestamp,
    authClient,
  } = input;

  const secretKey = input.secretKey ?? envStr('PROOFAGE_SECRET_KEY');
  const apiKey = input.apiKey ?? envStr('PROOFAGE_API_KEY');
  const tolerance = input.tolerance ?? envInt('PROOFAGE_WEBHOOK_TOLERANCE') ?? 300;

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
    throwErr('CONFIGURATION_ERROR', 'Webhook verification requires apiKey and secretKey (set PROOFAGE_API_KEY / PROOFAGE_SECRET_KEY)', 418);
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

  const expected = generateExpectedSignature(rawBody, ts, secretKey);

  if (signaturesMatch(signature, expected)) {
    return;
  }

  const canonicalBody = canonicalizeJsonPayload(rawBody);

  if (
    canonicalBody !== null
    && canonicalBody !== rawBody
    && signaturesMatch(signature, generateExpectedSignature(canonicalBody, ts, secretKey))
  ) {
    return;
  }

  throwErr('INVALID_SIGNATURE', 'HMAC signature is invalid');
}

export interface HandleWebhookOptions {
  /** Falls back to PROOFAGE_SECRET_KEY env var. */
  secretKey?: string;
  /** Falls back to PROOFAGE_API_KEY env var. */
  apiKey?: string;
  /** Seconds. Falls back to PROOFAGE_WEBHOOK_TOLERANCE env var, then 300. */
  tolerance?: number;
}

export interface HandleWebhookResult {
  verified: boolean;
  payload: WebhookPayload | null;
  error: string | null;
}

/**
 * High-level webhook handler: verify HMAC + parse payload in one call.
 * Works with any framework that gives you a standard `Request` object (Next.js, Hono, Cloudflare Workers, etc.).
 *
 * Returns a `HandleWebhookResult` — check `verified` before processing.
 * For a "middleware-like" approach that returns a `Response` directly, use `webhookHandler()`.
 */
export async function handleWebhook(request: Request, options: HandleWebhookOptions = {}): Promise<HandleWebhookResult> {
  const rawBody = await request.text();

  try {
    verifyWebhookSignature({
      rawBody,
      signature: request.headers.get('x-hmac-signature'),
      timestamp: request.headers.get('x-timestamp'),
      authClient: request.headers.get('x-auth-client'),
      secretKey: options.secretKey,
      apiKey: options.apiKey,
      tolerance: options.tolerance,
    });
  } catch (e) {
    const reason = e instanceof WebhookVerificationError ? `${e.code}: ${e.message}` : 'verification failed';
    return { verified: false, payload: null, error: reason };
  }

  try {
    const payload = rawBody ? (JSON.parse(rawBody) as WebhookPayload) : null;
    return { verified: true, payload, error: null };
  } catch {
    return { verified: false, payload: null, error: 'Invalid JSON body' };
  }
}

/**
 * Drop-in webhook route handler. Verifies HMAC, parses payload, calls your callback, returns a Response.
 * If verification fails, returns 401. If your callback throws, returns 500.
 *
 * @example
 * // Next.js App Router — entire route in one line:
 * export const POST = webhookHandler(async (payload) => {
 *   console.log('Verified:', payload.verification_id, payload.status);
 * });
 */
export function webhookHandler(
  onVerified: (payload: WebhookPayload) => void | Promise<void>,
  options: HandleWebhookOptions = {},
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const result = await handleWebhook(request, options);

    if (!result.verified || !result.payload) {
      return new Response(null, { status: result.error === 'Invalid JSON body' ? 400 : 401 });
    }

    try {
      await onVerified(result.payload);
    } catch {
      return new Response(null, { status: 500 });
    }

    return new Response(null, { status: 200 });
  };
}

/**
 * Generate webhook signature (for tests or outbound mocks). Matches `SendWebhook::generateSignature` in ProofAge.
 */
export function generateWebhookSignature(payload: Record<string, unknown>, secret: string, timestamp: number): string {
  const jsonPayload = JSON.stringify(payload);
  const signaturePayload = `${timestamp}.${jsonPayload}`;
  return createHmac('sha256', secret).update(signaturePayload, 'utf8').digest('hex');
}
