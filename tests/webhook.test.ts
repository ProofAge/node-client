import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { WebhookVerificationError } from '../src/errors.js';
import { generateWebhookSignature, handleWebhook, verifyWebhookSignature, webhookHandler } from '../src/webhook.js';

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

  it('accepts equivalent JSON with unicode escaping', () => {
    const payload = {
      verification_id: 'ver-escaped-unicode',
      status: 'approved',
      external_id: 'user_123',
      external_metadata: {
        name: 'Sample profile £ with unicode-ready metadata',
        email: 'webhook-sample@example.test',
        country_code: null,
      },
      reason: null,
      timestamp: '2026-05-01T07:32:27+00:00',
    };
    const rawBody = '{"verification_id":"ver-escaped-unicode","status":"approved","external_id":"user_123","external_metadata":{"name":"Sample profile \\u00a3 with unicode-ready metadata","email":"webhook-sample@example.test","country_code":null},"reason":null,"timestamp":"2026-05-01T07:32:27+00:00"}';
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

  it('resolves keys from process.env when omitted', () => {
    process.env.PROOFAGE_API_KEY = apiKey;
    process.env.PROOFAGE_SECRET_KEY = secretKey;

    try {
      const rawBody = '{"ok":true}';
      const ts = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature({ ok: true }, secretKey, ts);

      expect(() =>
        verifyWebhookSignature({ rawBody, signature, timestamp: ts, authClient: apiKey }),
      ).not.toThrow();
    } finally {
      delete process.env.PROOFAGE_API_KEY;
      delete process.env.PROOFAGE_SECRET_KEY;
    }
  });

  it('resolves tolerance from PROOFAGE_WEBHOOK_TOLERANCE env', () => {
    process.env.PROOFAGE_WEBHOOK_TOLERANCE = '0';

    try {
      const ts = Math.floor(Date.now() / 1000) - 1;
      const rawBody = '{}';
      const signature = generateWebhookSignature({}, secretKey, ts);

      expect(() =>
        verifyWebhookSignature({ rawBody, signature, timestamp: ts, authClient: apiKey, secretKey, apiKey }),
      ).toThrow(WebhookVerificationError);
    } finally {
      delete process.env.PROOFAGE_WEBHOOK_TOLERANCE;
    }
  });
});

describe('handleWebhook', () => {
  const secretKey = 'sk_test_12345678901234567890123456789012345678901234567890';
  const apiKey = 'pk_test_12345678901234567890123456789012345678901234567890';

  function buildRequest(payload: Record<string, unknown>): Request {
    const rawBody = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const signature = generateWebhookSignature(payload, secretKey, ts);

    return new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'x-hmac-signature': signature,
        'x-timestamp': String(ts),
        'x-auth-client': apiKey,
        'content-type': 'application/json',
      },
      body: rawBody,
    });
  }

  it('returns verified payload for valid request', async () => {
    const req = buildRequest({ verification_id: 'v1', status: 'approved', timestamp: '2025-01-01T00:00:00Z' });
    const result = await handleWebhook(req, { secretKey, apiKey });

    expect(result.verified).toBe(true);
    expect(result.payload?.verification_id).toBe('v1');
    expect(result.error).toBeNull();
  });

  it('returns a typed document on a webhook that carries one', async () => {
    const req = buildRequest({
      verification_id: 'v1',
      status: 'approved',
      timestamp: '2025-01-01T00:00:00Z',
      document: {
        type: 'passport',
        issuing_country: 'DE',
        fields: {
          first_name: 'ÉLODIE',
          middle_name: null,
          last_name: 'DOE',
          date_of_birth: '1990-04-12',
          gender: 'F',
          nationality: null,
          place_of_birth: 'BERLIN',
          address: '1 Main St\n10115 BERLIN',
          document_number: 'X1234567',
          issue_date: null,
          expiry_date: '2030-04-30',
        },
      },
    });
    const result = await handleWebhook(req, { secretKey, apiKey });

    expect(result.verified).toBe(true);
    expect(result.payload?.document?.type).toBe('passport');
    expect(result.payload?.document?.fields.first_name).toBe('ÉLODIE');
    expect(result.payload?.document?.fields.address).toBe('1 Main St\n10115 BERLIN');
  });

  it('parses an age webhook with the KYC-only keys absent and one without a document', async () => {
    const age = await handleWebhook(
      buildRequest({
        verification_id: 'v1',
        status: 'approved',
        timestamp: '2025-01-01T00:00:00Z',
        document: {
          type: 'id',
          issuing_country: 'FR',
          fields: { first_name: 'JEAN', last_name: 'MARTIN', date_of_birth: null, document_number: 'X1' },
        },
      }),
      { secretKey, apiKey },
    );
    const old = await handleWebhook(
      buildRequest({ verification_id: 'v1', status: 'approved', timestamp: '2025-01-01T00:00:00Z' }),
      { secretKey, apiKey },
    );

    expect(age.payload?.document?.fields).not.toHaveProperty('gender');
    expect(age.payload?.document?.fields.date_of_birth).toBeNull();
    expect(old.verified).toBe(true);
    expect(old.payload?.document).toBeUndefined();
  });

  it('parses a data.updated webhook: current status, corrected document, changed_fields', async () => {
    const result = await handleWebhook(
      buildRequest({
        verification_id: 'v1',
        event: 'data.updated',
        status: 'approved',
        external_id: 'user_1',
        external_metadata: null,
        reason: null,
        timestamp: '2026-10-08T09:30:00+00:00',
        document: {
          type: 'id',
          issuing_country: 'FR',
          issuing_subdivision: null,
          fields: { first_name: 'JEAN', last_name: 'MARTIN', date_of_birth: '1988-02-11', document_number: 'X1' },
        },
        changed_fields: ['date_of_birth'],
      }),
      { secretKey, apiKey },
    );

    expect(result.verified).toBe(true);
    expect(result.payload?.event).toBe('data.updated');
    expect(result.payload?.status).toBe('approved');
    expect(result.payload?.changed_fields).toEqual(['date_of_birth']);
    expect(result.payload?.document?.fields.date_of_birth).toBe('1988-02-11');
  });

  it('leaves event undefined on a body without it, which means status.updated', async () => {
    const result = await handleWebhook(
      buildRequest({ verification_id: 'v1', status: 'approved', timestamp: '2025-01-01T00:00:00Z' }),
      { secretKey, apiKey },
    );

    expect(result.payload?.event).toBeUndefined();
    expect(result.payload?.changed_fields).toBeUndefined();
  });

  it('returns error for invalid signature', async () => {
    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'x-hmac-signature': 'wrong',
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-auth-client': apiKey,
      },
      body: '{}',
    });

    const result = await handleWebhook(req, { secretKey, apiKey });
    expect(result.verified).toBe(false);
    expect(result.error).toContain('INVALID_SIGNATURE');
  });

  it('returns error for missing headers', async () => {
    const req = new Request('http://localhost/webhook', { method: 'POST', body: '{}' });
    const result = await handleWebhook(req, { secretKey, apiKey });
    expect(result.verified).toBe(false);
  });
});

describe('webhookHandler', () => {
  const secretKey = 'sk_test_12345678901234567890123456789012345678901234567890';
  const apiKey = 'pk_test_12345678901234567890123456789012345678901234567890';

  function buildRequest(payload: Record<string, unknown>): Request {
    const rawBody = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const signature = generateWebhookSignature(payload, secretKey, ts);

    return new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'x-hmac-signature': signature,
        'x-timestamp': String(ts),
        'x-auth-client': apiKey,
        'content-type': 'application/json',
      },
      body: rawBody,
    });
  }

  it('returns 200 on valid webhook', async () => {
    const handler = webhookHandler(async () => {}, { secretKey, apiKey });
    const res = await handler(buildRequest({ verification_id: 'v1', status: 'approved', timestamp: '2025-01-01T00:00:00Z' }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('returns 401 on invalid signature', async () => {
    const handler = webhookHandler(async () => {}, { secretKey, apiKey });
    const req = new Request('http://localhost/wh', {
      method: 'POST',
      headers: { 'x-hmac-signature': 'bad', 'x-timestamp': '1', 'x-auth-client': apiKey },
      body: '{}',
    });

    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it('calls onVerified with parsed payload', async () => {
    const spy = vi.fn();
    const handler = webhookHandler(spy, { secretKey, apiKey });
    await handler(buildRequest({ verification_id: 'v2', status: 'declined', timestamp: '2025-01-01T00:00:00Z' }));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].verification_id).toBe('v2');
  });

  it('returns 500 when onVerified throws', async () => {
    const handler = webhookHandler(
      async () => { throw new Error('oops'); },
      { secretKey, apiKey },
    );

    const res = await handler(buildRequest({ verification_id: 'v1', status: 'approved', timestamp: '2025-01-01T00:00:00Z' }));
    expect(res.status).toBe(500);
  });
});
