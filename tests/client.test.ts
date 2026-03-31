import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProofAgeClient } from '../src/client.js';
import { AuthenticationError, ProofAgeError, ValidationError } from '../src/errors.js';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
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

  it('sends X-API-Key and X-HMAC-Signature headers', async () => {
    const spy = vi.fn(async () => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', spy);

    const client = new ProofAgeClient(baseConfig);
    await client.workspace().get();

    expect(spy).toHaveBeenCalledOnce();
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
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
