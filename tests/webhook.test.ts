import { describe, expect, it, vi, afterEach } from 'vitest';
import { WebhookVerificationError } from '../src/errors.js';
import { generateWebhookSignature, verifyWebhookSignature } from '../src/webhook.js';

describe('verifyWebhookSignature', () => {
  const secretKey = 'sk_test_12345678901234567890123456789012345678901234567890';
  const apiKey = 'pk_test_12345678901234567890123456789012345678901234567890';

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a valid signature', () => {
    const payload = {
      verification_id: 'ver-1',
      status: 'approved',
      timestamp: '2025-01-01T00:00:00.000000Z',
    };
    const rawBody = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const signature = generateWebhookSignature(payload, secretKey, ts);

    expect(() =>
      verifyWebhookSignature({
        rawBody,
        signature,
        timestamp: ts,
        authClient: apiKey,
        secretKey,
        apiKey,
        tolerance: 300,
      }),
    ).not.toThrow();
  });

  it('accepts string timestamp', () => {
    const rawBody = '{"ok":true}';
    const ts = Math.floor(Date.now() / 1000);
    const signature = generateWebhookSignature({ ok: true }, secretKey, ts);

    expect(() =>
      verifyWebhookSignature({
        rawBody,
        signature,
        timestamp: String(ts),
        authClient: apiKey,
        secretKey,
        apiKey,
      }),
    ).not.toThrow();
  });

  it('rejects wrong signature', () => {
    const rawBody = '{"verification_id":"x"}';
    const ts = Math.floor(Date.now() / 1000);

    expect(() =>
      verifyWebhookSignature({
        rawBody,
        signature: 'deadbeef',
        timestamp: ts,
        authClient: apiKey,
        secretKey,
        apiKey,
      }),
    ).toThrow(WebhookVerificationError);
  });

  it('rejects missing signature header', () => {
    try {
      verifyWebhookSignature({
        rawBody: '{}',
        signature: null,
        timestamp: '1',
        authClient: apiKey,
        secretKey,
        apiKey,
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookVerificationError);
      expect((e as WebhookVerificationError).code).toBe('MISSING_SIGNATURE');
    }
  });

  it('rejects missing timestamp header', () => {
    try {
      verifyWebhookSignature({
        rawBody: '{}',
        signature: 'abc',
        timestamp: null,
        authClient: apiKey,
        secretKey,
        apiKey,
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookVerificationError);
      expect((e as WebhookVerificationError).code).toBe('MISSING_TIMESTAMP');
    }
  });

  it('rejects missing auth client header', () => {
    try {
      verifyWebhookSignature({
        rawBody: '{}',
        signature: 'abc',
        timestamp: '1',
        authClient: null,
        secretKey,
        apiKey,
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookVerificationError);
      expect((e as WebhookVerificationError).code).toBe('MISSING_AUTH_CLIENT');
    }
  });

  it('rejects invalid auth client', () => {
    const rawBody = '{}';
    const ts = Math.floor(Date.now() / 1000);
    const signature = generateWebhookSignature({}, secretKey, ts);

    try {
      verifyWebhookSignature({
        rawBody,
        signature,
        timestamp: ts,
        authClient: 'wrong-key',
        secretKey,
        apiKey,
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookVerificationError);
      expect((e as WebhookVerificationError).code).toBe('INVALID_AUTH_CLIENT');
    }
  });

  it('rejects missing secretKey/apiKey config', () => {
    try {
      verifyWebhookSignature({
        rawBody: '{}',
        signature: 'abc',
        timestamp: '1',
        authClient: 'x',
        secretKey: undefined,
        apiKey: undefined,
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookVerificationError);
      expect((e as WebhookVerificationError).code).toBe('CONFIGURATION_ERROR');
      expect((e as WebhookVerificationError).httpStatus).toBe(418);
    }
  });

  it('rejects expired timestamp (TIMESTAMP_TOO_OLD)', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 600;
    const rawBody = '{}';
    const signature = generateWebhookSignature({}, secretKey, oldTs);

    try {
      verifyWebhookSignature({
        rawBody,
        signature,
        timestamp: oldTs,
        authClient: apiKey,
        secretKey,
        apiKey,
        tolerance: 300,
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookVerificationError);
      expect((e as WebhookVerificationError).code).toBe('TIMESTAMP_TOO_OLD');
    }
  });

  it('respects custom tolerance=0', () => {
    const ts = Math.floor(Date.now() / 1000) - 1;
    const rawBody = '{}';
    const signature = generateWebhookSignature({}, secretKey, ts);

    expect(() =>
      verifyWebhookSignature({
        rawBody,
        signature,
        timestamp: ts,
        authClient: apiKey,
        secretKey,
        apiKey,
        tolerance: 0,
      }),
    ).toThrow(WebhookVerificationError);
  });
});
