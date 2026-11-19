import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProofAgeClient } from '../src/client.js';
import { ProofAgeError } from '../src/errors.js';

/**
 * X-Timestamp and Idempotency-Key. The API accepts a timestamped request once, so every attempt,
 * retries included, is stamped and signed anew; a create call carries an Idempotency-Key that
 * stays the same across its own attempts, which is what makes it safe to retry.
 */
const baseConfig = { apiKey: 'pk', secretKey: 'sk', baseUrl: 'https://api.test.com', retryAttempts: 3, retryDelay: 1 };

const created = () => new Response(JSON.stringify({ id: 'ver_1' }), { status: 201 });
const failure = (status: number, body: unknown = { message: 'x' }, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function headersOf(spy: ReturnType<typeof vi.fn>, index: number): Record<string, string> {
  return (spy.mock.calls[index] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
}

/** A clock that advances one second per read, so two attempts never share a timestamp. */
function ticking(startSeconds = 1795049078): () => number {
  let now = startSeconds * 1000 - 1000;
  return () => (now += 1000);
}

function networkError(code: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('X-Timestamp', () => {
  it('is sent on every request and signed as {timestamp}.{legacy canonical}', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: 'ws' }), { status: 200 }));
    vi.stubGlobal('fetch', spy);

    await new ProofAgeClient({ ...baseConfig, clock: () => 1795049078999 }).workspace().get();

    const headers = headersOf(spy, 0);
    expect(headers['X-Timestamp']).toBe('1795049078');
    expect(headers['X-HMAC-Signature']).toBe(
      createHmac('sha256', 'sk').update('1795049078.GET/v1/workspace', 'utf8').digest('hex'),
    );
  });

  it('uses the current time by default, in whole seconds', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: 'ws' }), { status: 200 }));
    vi.stubGlobal('fetch', spy);

    const before = Math.floor(Date.now() / 1000);
    await new ProofAgeClient(baseConfig).workspace().get();

    const sent = headersOf(spy, 0)['X-Timestamp']!;
    expect(sent).toMatch(/^\d{10}$/);
    expect(Number(sent)).toBeGreaterThanOrEqual(before);
    expect(Number(sent)).toBeLessThanOrEqual(before + 2);
  });

  it('stamps and signs a retried request again on every attempt', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(failure(503))
      .mockResolvedValueOnce(failure(503))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ws' }), { status: 200 }));
    vi.stubGlobal('fetch', spy);

    await new ProofAgeClient({ ...baseConfig, clock: ticking() }).workspace().get();

    const attempts = [0, 1, 2].map((i) => headersOf(spy, i));
    expect(attempts.map((h) => h['X-Timestamp'])).toEqual(['1795049078', '1795049079', '1795049080']);
    expect(new Set(attempts.map((h) => h['X-HMAC-Signature'])).size).toBe(3);
    for (const h of attempts) {
      expect(h['X-HMAC-Signature']).toBe(
        createHmac('sha256', 'sk').update(`${h['X-Timestamp']}.GET/v1/workspace`, 'utf8').digest('hex'),
      );
    }
  });

  it('signs a multipart upload with the timestamp and re-signs its retry', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(failure(429, { error: { code: 'RATE_LIMIT' } }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', spy);

    await new ProofAgeClient({ ...baseConfig, clock: ticking() })
      .verifications('ver_1')
      .uploadMedia({ type: 'selfie', file: Buffer.from('bytes') });

    expect(spy).toHaveBeenCalledTimes(2);
    const [a, b] = [headersOf(spy, 0), headersOf(spy, 1)];
    expect(a['X-Timestamp']).toBe('1795049078');
    expect(b['X-Timestamp']).toBe('1795049079');
    expect(a['X-HMAC-Signature']).not.toBe(b['X-HMAC-Signature']);
  });

  it('is sent on a download too', async () => {
    const spy = vi.fn(async () => new Response('bytes', { status: 200 }));
    vi.stubGlobal('fetch', spy);

    await new ProofAgeClient({ ...baseConfig, clock: () => 1795049078000 }).verifications('v').downloadMedia('m');

    expect(headersOf(spy, 0)['X-Timestamp']).toBe('1795049078');
  });
});

describe('Idempotency-Key', () => {
  it('is a UUID v4 on verifications.create and webhookSubscriptions.create, and nowhere else', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const client = new ProofAgeClient(baseConfig);

    await client.verifications().create({});
    await client.webhookSubscriptions().create({ url: 'https://example.com/hook' });
    await client.verifications('v').submit();
    await client.verifications('v').find('v');
    await client.workspace().get();
    await client.webhookSubscriptions().delete('id');

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(headersOf(spy, 0)['Idempotency-Key']).toMatch(uuid);
    expect(headersOf(spy, 1)['Idempotency-Key']).toMatch(uuid);
    expect(headersOf(spy, 0)['Idempotency-Key']).not.toBe(headersOf(spy, 1)['Idempotency-Key']);
    for (const i of [2, 3, 4, 5]) {
      expect(headersOf(spy, i)).not.toHaveProperty('Idempotency-Key');
    }
  });

  it('is not part of the signature', async () => {
    const spy = vi.fn(async () => created());
    vi.stubGlobal('fetch', spy);

    await new ProofAgeClient({ ...baseConfig, clock: () => 1795049078000 })
      .verifications()
      .create({ external_id: 'u1' });

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(headersOf(spy, 0)['X-HMAC-Signature']).toBe(
      createHmac('sha256', 'sk').update(`1795049078.POST/v1/verifications${init.body as string}`, 'utf8').digest('hex'),
    );
  });

  it('honours a key the caller passes', async () => {
    const spy = vi.fn(async () => created());
    vi.stubGlobal('fetch', spy);
    const client = new ProofAgeClient(baseConfig);

    await client.verifications().create({}, { idempotencyKey: 'order-42' });
    await client.webhookSubscriptions().create({ url: 'https://example.com/hook' }, { idempotencyKey: 'sub-7' });

    expect(headersOf(spy, 0)['Idempotency-Key']).toBe('order-42');
    expect(headersOf(spy, 1)['Idempotency-Key']).toBe('sub-7');
  });

  it('refuses a key the API would refuse, before sending', async () => {
    const spy = vi.fn(async () => created());
    vi.stubGlobal('fetch', spy);
    const client = new ProofAgeClient(baseConfig);

    await expect(client.verifications().create({}, { idempotencyKey: '' })).rejects.toThrow(TypeError);
    await expect(client.verifications().create({}, { idempotencyKey: 'has space' })).rejects.toThrow(TypeError);
    await expect(client.verifications().create({}, { idempotencyKey: 'x'.repeat(256) })).rejects.toThrow(TypeError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stays the same across attempts while the timestamp and signature change', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(failure(503))
      .mockRejectedValueOnce(networkError('ECONNRESET'))
      .mockResolvedValueOnce(created());
    vi.stubGlobal('fetch', spy);

    const v = await new ProofAgeClient({ ...baseConfig, clock: ticking() }).verifications().create({ external_id: 'u' });

    expect(v?.id).toBe('ver_1');
    expect(spy).toHaveBeenCalledTimes(3);
    const attempts = [0, 1, 2].map((i) => headersOf(spy, i));
    expect(new Set(attempts.map((h) => h['Idempotency-Key'])).size).toBe(1);
    expect(new Set(attempts.map((h) => h['X-Timestamp'])).size).toBe(3);
    expect(new Set(attempts.map((h) => h['X-HMAC-Signature'])).size).toBe(3);
  });

  it('is retried on 408, 429 and 5xx like a GET', async () => {
    for (const status of [408, 429, 500, 502, 504]) {
      const spy = vi.fn().mockResolvedValueOnce(failure(status, { message: 'x' }, { 'Retry-After': '0' })).mockResolvedValueOnce(created());
      vi.stubGlobal('fetch', spy);
      await new ProofAgeClient(baseConfig).verifications().create({});
      expect(spy, `status ${status}`).toHaveBeenCalledTimes(2);
    }
  });

  it('retries a POST with a key on 503 while one without a key is not retried', async () => {
    const withKey = vi.fn().mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(created());
    vi.stubGlobal('fetch', withKey);
    await new ProofAgeClient(baseConfig).verifications().create({});
    expect(withKey).toHaveBeenCalledTimes(2);

    const withoutKey = vi.fn(async () => failure(503));
    vi.stubGlobal('fetch', withoutKey);
    await expect(new ProofAgeClient(baseConfig).verifications('v').submit()).rejects.toThrow(ProofAgeError);
    expect(withoutKey).toHaveBeenCalledTimes(1);
  });

  it('waits out 409 IDEMPOTENCY_KEY_IN_PROGRESS on Retry-After and retries with the same key', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(
        failure(409, { error: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message: 'busy' } }, { 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(created());
    vi.stubGlobal('fetch', spy);

    const v = await new ProofAgeClient({ ...baseConfig, clock: ticking() }).verifications().create({});

    expect(v?.id).toBe('ver_1');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(headersOf(spy, 1)['Idempotency-Key']).toBe(headersOf(spy, 0)['Idempotency-Key']);
    expect(headersOf(spy, 1)['X-Timestamp']).not.toBe(headersOf(spy, 0)['X-Timestamp']);
  });

  it('does not retry IDEMPOTENCY_KEY_REUSED or other 4xx', async () => {
    for (const [status, code] of [
      [409, 'IDEMPOTENCY_KEY_REUSED'],
      [400, 'IDEMPOTENCY_KEY_INVALID'],
    ] as const) {
      const spy = vi.fn(async () => failure(status, { error: { code, message: 'no' } }));
      vi.stubGlobal('fetch', spy);
      const e = (await new ProofAgeClient(baseConfig).verifications().create({}).catch((x: unknown) => x)) as ProofAgeError;
      expect(e.code).toBe(code);
      expect(spy, code).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after retryAttempts on a persistent 5xx', async () => {
    const spy = vi.fn(async () => failure(503));
    vi.stubGlobal('fetch', spy);
    await expect(new ProofAgeClient(baseConfig).verifications().create({})).rejects.toThrow(ProofAgeError);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('REPLAYED_REQUEST', () => {
  const replayed = () => failure(401, { error: { code: 'REPLAYED_REQUEST', message: 'replayed' } });

  it('is resent once with a new timestamp and signature, keeping the Idempotency-Key', async () => {
    const spy = vi.fn().mockResolvedValueOnce(replayed()).mockResolvedValueOnce(created());
    vi.stubGlobal('fetch', spy);

    // retryAttempts: 1 would not retry anything else
    const v = await new ProofAgeClient({ ...baseConfig, retryAttempts: 1, clock: ticking() }).verifications().create({});

    expect(v?.id).toBe('ver_1');
    expect(spy).toHaveBeenCalledTimes(2);
    const [a, b] = [headersOf(spy, 0), headersOf(spy, 1)];
    expect(b['X-Timestamp']).not.toBe(a['X-Timestamp']);
    expect(b['X-HMAC-Signature']).not.toBe(a['X-HMAC-Signature']);
    expect(b['Idempotency-Key']).toBe(a['Idempotency-Key']);
  });

  it('applies to a POST without a key too', async () => {
    const spy = vi.fn().mockResolvedValueOnce(replayed()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', spy);

    await new ProofAgeClient({ ...baseConfig, retryAttempts: 1, clock: ticking() }).verifications('v').submit();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(headersOf(spy, 1)).not.toHaveProperty('Idempotency-Key');
  });

  it('throws a second REPLAYED_REQUEST', async () => {
    const spy = vi.fn(async () => replayed());
    vi.stubGlobal('fetch', spy);

    const e = (await new ProofAgeClient({ ...baseConfig, clock: ticking() })
      .verifications()
      .create({})
      .catch((x: unknown) => x)) as ProofAgeError;

    expect(e.code).toBe('REPLAYED_REQUEST');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('is never resent for a GET', async () => {
    const spy = vi.fn(async () => replayed());
    vi.stubGlobal('fetch', spy);

    await expect(new ProofAgeClient({ ...baseConfig, clock: ticking() }).workspace().get()).rejects.toThrow(ProofAgeError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
