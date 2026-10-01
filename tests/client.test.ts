import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProofAgeClient } from '../src/client.js';
import { AuthenticationError, ProofAgeError, ValidationError } from '../src/errors.js';
import type { UploadMediaPayload } from '../src/types.js';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

function fetchCall(spy: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
  return spy.mock.calls[index] as unknown as [string, RequestInit];
}

describe('ProofAgeClient', () => {
  const baseConfig = {
    apiKey: 'test-api-key',
    secretKey: 'test-secret-key',
    baseUrl: 'https://api.test.com',
    version: 'v1',
    retryAttempts: 1,
  };

  beforeEach(() => {
    mockFetch(200, { name: 'Test Workspace', id: 'ws_123' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when api key is missing', () => {
    expect(() => new ProofAgeClient({ ...baseConfig, apiKey: '' })).toThrow('API key is required');
  });

  it('throws when secret key is missing', () => {
    expect(() => new ProofAgeClient({ ...baseConfig, secretKey: '' })).toThrow('Secret key is required');
  });

  it('resolves config from process.env', () => {
    process.env.PROOFAGE_API_KEY = 'pk_env';
    process.env.PROOFAGE_SECRET_KEY = 'sk_env';
    process.env.PROOFAGE_BASE_URL = 'https://env.example.com';

    try {
      const client = new ProofAgeClient();
      const cfg = client.getConfig();
      expect(cfg.apiKey).toBe('pk_env');
      expect(cfg.secretKey).toBe('sk_env');
      expect(cfg.baseUrl).toBe('https://env.example.com');
    } finally {
      delete process.env.PROOFAGE_API_KEY;
      delete process.env.PROOFAGE_SECRET_KEY;
      delete process.env.PROOFAGE_BASE_URL;
    }
  });

  it('fromEnv() creates client from env with overrides', () => {
    process.env.PROOFAGE_API_KEY = 'pk_env';
    process.env.PROOFAGE_SECRET_KEY = 'sk_env';

    try {
      const client = ProofAgeClient.fromEnv({ baseUrl: 'https://override.com' });
      const cfg = client.getConfig();
      expect(cfg.apiKey).toBe('pk_env');
      expect(cfg.baseUrl).toBe('https://override.com');
    } finally {
      delete process.env.PROOFAGE_API_KEY;
      delete process.env.PROOFAGE_SECRET_KEY;
    }
  });

  it('explicit config takes precedence over env', () => {
    process.env.PROOFAGE_API_KEY = 'pk_env';
    process.env.PROOFAGE_SECRET_KEY = 'sk_env';

    try {
      const client = new ProofAgeClient({ apiKey: 'pk_explicit', secretKey: 'sk_explicit' });
      const cfg = client.getConfig();
      expect(cfg.apiKey).toBe('pk_explicit');
      expect(cfg.secretKey).toBe('sk_explicit');
    } finally {
      delete process.env.PROOFAGE_API_KEY;
      delete process.env.PROOFAGE_SECRET_KEY;
    }
  });

  it('gets workspace', async () => {
    const client = new ProofAgeClient(baseConfig);
    const ws = await client.workspace().get();
    expect(ws?.name).toBe('Test Workspace');
  });

  it('creates verification', async () => {
    mockFetch(200, { id: 'ver_123', status: 'created' });
    const client = new ProofAgeClient(baseConfig);
    const v = await client.verifications().create({ callback_url: 'https://x.com/wh' });
    expect(v?.id).toBe('ver_123');
  });

  it('blocks verification face', async () => {
    const spy = vi.fn(async () => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient(baseConfig);
    const result = await client.verifications('ver_123').blockFace();

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = fetchCall(spy);
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.test.com/v1/verifications/ver_123/blocked-face');
    expect(init.method).toBe('POST');
    expect(headers['X-HMAC-Signature']).toBeDefined();
  });

  it('gets verification document result', async () => {
    const spy = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            document: {
              fields: {
                first_name: 'John',
                last_name: 'Doe',
                date_of_birth: '1990-01-15',
                document_number: 'AB123456',
              },
            },
            media: [
              {
                id: 'media_selfie',
                type: 'selfie',
                signed_url: 'https://storage.test/selfie.jpg',
                expires_at: '2026-05-18T13:00:00+00:00',
              },
            ],
            meta: {
              attempt_id: 'attempt_123',
              signed_url_ttl_seconds: 3600,
              signed_url_expires_at: '2026-05-18T13:00:00+00:00',
            },
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient(baseConfig);
    const result = await client.verifications('ver_123').document();

    expect(result?.document).toMatchObject({
      fields: {
        first_name: 'John',
        document_number: 'AB123456',
      },
    });
    expect(result?.meta).toMatchObject({
      signed_url_ttl_seconds: 3600,
    });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = fetchCall(spy);
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.test.com/v1/verifications/ver_123/document');
    expect(init.method).toBe('GET');
    expect(headers['X-HMAC-Signature']).toBeDefined();
  });

  it('parses a KYC document body with all ten fields and an unknown type', async () => {
    const body = {
      document: {
        type: 'health_card',
        issuing_country: 'DE',
        fields: {
          first_name: 'JANE',
          middle_name: null,
          last_name: 'DOE',
          date_of_birth: '1990-04-12',
          gender: 'F',
          nationality: 'DE',
          place_of_birth: 'BERLIN',
          address: 'Rua das Flores 12\n1000-001 LISBOA',
          document_number: 'X1234567',
          issue_date: '2020-04-14',
          expiry_date: '2030-04-30',
        },
      },
      media: [],
      meta: { attempt_id: 'attempt_123' },
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));

    const result = await new ProofAgeClient(baseConfig).verifications('ver_123').document();

    expect(result?.document.type).toBe('health_card');
    expect(result?.document.issuing_country).toBe('DE');
    expect(Object.keys(result?.document.fields ?? {})).toHaveLength(11);
    expect(result?.document.fields.address).toBe('Rua das Flores 12\n1000-001 LISBOA');
    expect(result?.document.fields.expiry_date).toBe('2030-04-30');
  });

  it('parses an age-workspace document body where the KYC-only keys are absent', async () => {
    const body = {
      document: {
        type: 'id',
        issuing_country: 'FR',
        fields: { first_name: 'JEAN', last_name: 'MARTIN', date_of_birth: null, document_number: 'X4RTBPFW4' },
      },
      media: [],
      meta: { attempt_id: null },
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));

    const result = await new ProofAgeClient(baseConfig).verifications('ver_123').document();

    expect(result?.document.type).toBe('id');
    expect(result?.document.fields.date_of_birth).toBeNull();
    expect(result?.document.fields).not.toHaveProperty('gender');
    expect(result?.document.fields).not.toHaveProperty('address');
    expect(result?.document.fields).not.toHaveProperty('expiry_date');
  });

  it('throws when getting verification document without id', async () => {
    const client = new ProofAgeClient(baseConfig);

    await expect(client.verifications().document()).rejects.toThrow(TypeError);
    await expect(client.verifications().document()).rejects.toThrow('Verification ID is required');
  });

  it('throws when blocking verification face without id', async () => {
    const client = new ProofAgeClient(baseConfig);

    await expect(client.verifications().blockFace()).rejects.toThrow(TypeError);
    await expect(client.verifications().blockFace()).rejects.toThrow('Verification ID is required');
  });

  it('sends X-API-Key and X-HMAC-Signature headers', async () => {
    const spy = vi.fn(async () => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient(baseConfig);
    await client.workspace().get();

    expect(spy).toHaveBeenCalledOnce();
    const [, init] = fetchCall(spy);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('test-api-key');
    expect(headers['X-HMAC-Signature']).toBeDefined();
    expect(headers['X-HMAC-Signature'].length).toBe(64);
  });

  it('throws AuthenticationError on 401', async () => {
    mockFetch(401, { error: { message: 'Invalid API key' } });
    const client = new ProofAgeClient(baseConfig);
    await expect(client.workspace().get()).rejects.toThrow(AuthenticationError);
  });

  it('throws ValidationError on 422 with field errors', async () => {
    mockFetch(422, {
      error: { message: 'Validation failed' },
      errors: { callback_url: ['required'] },
    });
    const client = new ProofAgeClient(baseConfig);

    try {
      await client.verifications().create({});
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).getErrors()).toEqual({ callback_url: ['required'] });
    }
  });

  it('throws ProofAgeError on 500', async () => {
    mockFetch(500, { error: { message: 'Internal error' } });
    const client = new ProofAgeClient(baseConfig);
    await expect(client.workspace().get()).rejects.toThrow(ProofAgeError);
  });

  it('retries on 5xx and eventually throws', async () => {
    const spy = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 })),
    );
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient({ ...baseConfig, retryAttempts: 3, retryDelay: 1 });
    await expect(client.workspace().get()).rejects.toThrow(ProofAgeError);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('retries on network error', async () => {
    const spy = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient({ ...baseConfig, retryAttempts: 2, retryDelay: 1 });
    await expect(client.workspace().get()).rejects.toThrow(TypeError);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx (except 408/429)', async () => {
    const spy = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 })),
    );
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient({ ...baseConfig, retryAttempts: 3, retryDelay: 1 });
    await expect(client.workspace().get()).rejects.toThrow(ProofAgeError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('media download', () => {
  const baseConfig = {
    apiKey: 'test-api-key',
    secretKey: 'test-secret-key',
    baseUrl: 'https://api.test.com',
    version: 'v1',
    retryAttempts: 3,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams the bytes and signs the media path', async () => {
    const spy = vi.fn(async () =>
      Promise.resolve(new Response('binary-image-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })),
    );
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient(baseConfig);
    const body = await client.verifications('ver_1').downloadMedia('med_1');

    expect(await new Response(body).text()).toBe('binary-image-bytes');

    const [url, init] = fetchCall(spy);
    expect(url).toBe('https://api.test.com/v1/verifications/ver_1/media/med_1');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('test-api-key');
    expect(headers['X-HMAC-Signature']).toBeTruthy();
    // JSON first, so the API renders its errors as JSON (Laravel expectsJson()); a successful
    // download streams the file whatever Accept says.
    expect(headers.Accept).toBe('application/json, */*;q=0.8');
  });

  it('does not retry a rate limit on a download', async () => {
    const spy = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'RATE_LIMIT' } }), { status: 429 })),
    );
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient(baseConfig);

    await expect(client.verifications('ver_1').downloadMedia('med_1')).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 404 for media that is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'MEDIA_NOT_FOUND', message: 'Media not found.' } }), {
            status: 404,
          }),
        ),
      ),
    );

    const client = new ProofAgeClient(baseConfig);

    await expect(client.verifications('ver_1').downloadMedia('med_1')).rejects.toMatchObject({ statusCode: 404, errorData: { code: 'MEDIA_NOT_FOUND' } });
  });

  it('requires a verification id', async () => {
    const client = new ProofAgeClient(baseConfig);

    await expect(client.verifications().downloadMedia('med_1')).rejects.toThrow('Verification ID is required');
  });
});

describe('base URL', () => {
  const keys = { apiKey: 'pk', secretKey: 'sk' };

  it('defaults to the API origin', () => {
    expect(new ProofAgeClient(keys).getConfig().baseUrl).toBe('https://api.proofage.xyz');
  });

  it('strips a trailing /v1 copied from the OpenAPI servers entry', () => {
    expect(new ProofAgeClient({ ...keys, baseUrl: 'https://api.proofage.xyz/v1/' }).getConfig().baseUrl).toBe(
      'https://api.proofage.xyz',
    );
  });

  it('keeps a proxy path prefix', () => {
    expect(new ProofAgeClient({ ...keys, baseUrl: 'https://gw.example.com/proofage/' }).getConfig().baseUrl).toBe(
      'https://gw.example.com/proofage',
    );
  });

  it('rejects something that is not a URL', () => {
    expect(() => new ProofAgeClient({ ...keys, baseUrl: 'api.proofage.xyz' })).toThrow(/Invalid baseUrl/);
  });
});

describe('error shapes', () => {
  const baseConfig = { apiKey: 'pk', secretKey: 'sk', baseUrl: 'https://api.test.com', retryAttempts: 1 };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function caught(promise: Promise<unknown>): Promise<ProofAgeError> {
    try {
      await promise;
    } catch (e) {
      return e as ProofAgeError;
    }
    throw new Error('expected a rejection');
  }

  it('unwraps { error: { code, message } }', async () => {
    mockFetch(401, { error: { code: 'INVALID_SIGNATURE', message: 'HMAC signature is invalid' } });
    const e = await caught(new ProofAgeClient(baseConfig).workspace().get());
    expect(e).toBeInstanceOf(AuthenticationError);
    expect(e.message).toBe('HMAC signature is invalid');
    expect(e.code).toBe('INVALID_SIGNATURE');
    expect(e.getErrorCode()).toBe('INVALID_SIGNATURE');
  });

  it('keeps a flat 402 body whole, trial fields included', async () => {
    mockFetch(402, {
      code: 'PAYMENT_METHOD_REQUIRED',
      message: 'A payment method is required to create verifications.',
      free_verifications_remaining: 0,
      trial_ends_at: null,
      trial_active: false,
    });
    const e = await caught(new ProofAgeClient(baseConfig).verifications().create({}));
    expect(e).toBeInstanceOf(ProofAgeError);
    expect(e.statusCode).toBe(402);
    expect(e.code).toBe('PAYMENT_METHOD_REQUIRED');
    expect(e.message).toBe('A payment method is required to create verifications.');
    expect(e.errorData).toMatchObject({ free_verifications_remaining: 0, trial_active: false });
  });

  it('reads a flat media-quality 422 as a ValidationError with its code', async () => {
    mockFetch(422, { code: 'FACE_NOT_FOUND', message: 'Face validation failed.' });
    const e = await caught(
      new ProofAgeClient(baseConfig).verifications('ver_1').uploadMedia({ type: 'selfie', file: Buffer.from('x') }),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.code).toBe('FACE_NOT_FOUND');
    expect(e.message).toBe('Face validation failed.');
    expect((e as ValidationError).getErrors()).toEqual({});
  });

  it('reads Laravel { message, errors } validation bodies', async () => {
    mockFetch(422, {
      message: 'The side field is required when type is document.',
      errors: { side: ['The side field is required when type is document.'] },
    });
    const e = await caught(new ProofAgeClient(baseConfig).verifications().create({}));
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toBe('The side field is required when type is document.');
    expect((e as ValidationError).getErrors()).toEqual({ side: ['The side field is required when type is document.'] });
    expect(e.code).toBeUndefined();
  });

  it('reads a bare { message } 404', async () => {
    mockFetch(404, { message: 'Resource not found' });
    const e = await caught(new ProofAgeClient(baseConfig).verifications().find('nope'));
    expect(e.statusCode).toBe(404);
    expect(e.message).toBe('Resource not found');
    expect(e.errorData).toEqual({ message: 'Resource not found' });
  });

  it('reads a bare { message } 403', async () => {
    mockFetch(403, { message: 'Access denied to this verification.' });
    const e = await caught(new ProofAgeClient(baseConfig).verifications('v').document());
    expect(e.statusCode).toBe(403);
    expect(e.message).toBe('Access denied to this verification.');
  });

  it('falls back to the status and a snippet for a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
    const e = await caught(new ProofAgeClient(baseConfig).workspace().get());
    expect(e.message).toBe('HTTP 502: <html>Bad Gateway</html>');
    expect(e.errorData).toBeUndefined();
  });
});

describe('response bodies', () => {
  const baseConfig = { apiKey: 'pk', secretKey: 'sk', baseUrl: 'https://api.test.com', retryAttempts: 1 };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves uploadMedia() and submit() to null on the empty 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const v = new ProofAgeClient(baseConfig).verifications('ver_1');
    await expect(v.uploadMedia({ type: 'selfie', file: Buffer.from('x') })).resolves.toBeNull();
    await expect(v.submit()).resolves.toBeNull();
  });

  it('throws on a non-empty 2xx body that is not JSON (wrong baseUrl)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><title>Home</title>', { status: 200, headers: { 'Content-Type': 'text/html' } })),
    );
    const e = await new ProofAgeClient(baseConfig).workspace().get().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProofAgeError);
    expect((e as ProofAgeError).message).toMatch(/non-JSON body.*text\/html.*baseUrl/);
  });
});

describe('uploadMedia', () => {
  const baseConfig = { apiKey: 'pk', secretKey: 'test-secret-key', baseUrl: 'https://api.test.com', retryAttempts: 1 };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends and signs a document upload exactly as the server recomputes it', async () => {
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);

    await new ProofAgeClient(baseConfig).verifications('ver_123').uploadMedia({
      type: 'document',
      side: 'front',
      document: 'passport',
      file: Buffer.from('fake-image-bytes'),
      filename: 'front.jpg',
      head_turn_step: 2,
      device_info: { platform: 'MacIntel', ua: 'Mozilla/5.0 (X11)' },
      fingerprint: null,
    });

    const [url, init] = fetchCall(spy);
    expect(url).toBe('https://api.test.com/v1/verifications/ver_123/media');
    const form = init.body as FormData;
    expect(form.get('type')).toBe('document');
    expect(form.get('side')).toBe('front');
    expect(form.get('document')).toBe('passport');
    expect(form.get('head_turn_step')).toBe('2');
    expect(form.get('device_info')).toBe('{"platform":"MacIntel","ua":"Mozilla/5.0 (X11)"}');
    expect(form.has('fingerprint')).toBe(false);
    expect((form.get('file') as File).name).toBe('front.jpg');

    // PHP, with the middleware's algorithm over those same fields:
    //   ksort($f); $q = http_build_query($f, '', '&', PHP_QUERY_RFC3986);
    //   hash_hmac('sha256', "POST/v1/verifications/ver_123/media\n$q\n".hash('sha256', 'fake-image-bytes'), 'test-secret-key')
    const headers = init.headers as Record<string, string>;
    expect(headers['X-HMAC-Signature']).toBe('d04610352d2f5738d33217ac4c7395c701ee3f0c885822b625830d569f894fda');
  });

  it('requires side and document on a document upload at the type level', () => {
    const file = Buffer.from('x');
    // @ts-expect-error — a document upload without side/document would answer 422
    const missing: UploadMediaPayload = { type: 'document', file };
    // @ts-expect-error — side is only meaningful for documents
    const stray: UploadMediaPayload = { type: 'selfie', side: 'front', file };
    const ok: UploadMediaPayload = { type: 'document', side: 'back', document: 'driver_license', file };
    expect([missing, stray, ok]).toHaveLength(3);
  });
});

describe('retry policy', () => {
  const baseConfig = { apiKey: 'pk', secretKey: 'sk', baseUrl: 'https://api.test.com', retryAttempts: 3, retryDelay: 1 };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function networkError(code: string): TypeError {
    return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  }

  it('does not retry a POST on 5xx', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 }));
    vi.stubGlobal('fetch', spy);
    await expect(new ProofAgeClient(baseConfig).verifications().create({})).rejects.toThrow(ProofAgeError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not retry a POST on a timeout', async () => {
    const spy = vi.fn(async () => {
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', spy);
    await expect(new ProofAgeClient(baseConfig).verifications('v').submit()).rejects.toThrow('aborted');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not retry a POST whose connection dropped mid-request', async () => {
    const spy = vi.fn().mockRejectedValue(networkError('ECONNRESET'));
    vi.stubGlobal('fetch', spy);
    await expect(new ProofAgeClient(baseConfig).verifications().create({})).rejects.toThrow('fetch failed');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries a POST that never reached the server', async () => {
    const spy = vi
      .fn()
      .mockRejectedValueOnce(networkError('ECONNREFUSED'))
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: new AggregateError([networkError('ENOTFOUND').cause, networkError('ECONNREFUSED').cause]),
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ver_1' }), { status: 201 }));
    vi.stubGlobal('fetch', spy);
    const v = await new ProofAgeClient(baseConfig).verifications().create({});
    expect(v?.id).toBe('ver_1');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('retries a POST on 429, honouring Retry-After over the backoff', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'RATE_LIMIT' } }), { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ver_1' }), { status: 201 }));
    vi.stubGlobal('fetch', spy);

    // A 60 s backoff would time the test out; Retry-After: 0 is what lets it finish.
    const client = new ProofAgeClient({ ...baseConfig, retryDelay: 60_000 });
    const v = await client.verifications().create({});
    expect(v?.id).toBe('ver_1');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('still retries a GET on a timeout', async () => {
    const spy = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ws' }), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const ws = await new ProofAgeClient(baseConfig).workspace().get();
    expect(ws?.id).toBe('ws');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
