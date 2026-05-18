import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProofAgeClient } from '../src/client.js';
import { AuthenticationError, ProofAgeError, ValidationError } from '../src/errors.js';

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
    const ws = (await client.workspace().get()) as Record<string, unknown> | null;
    expect(ws?.name).toBe('Test Workspace');
  });

  it('creates verification', async () => {
    mockFetch(200, { id: 'ver_123', status: 'created' });
    const client = new ProofAgeClient(baseConfig);
    const v = (await client.verifications().create({ callback_url: 'https://x.com/wh' })) as Record<string, unknown> | null;
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
