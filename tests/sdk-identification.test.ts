import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProofAgeClient } from '../src/client.js';
import { ProofAgeError } from '../src/errors.js';
import { generateHmacSignature } from '../src/hmac.js';
import { SDK_VERSION } from '../src/version.js';

/**
 * Every request identifies the SDK that sent it:
 *
 *   X-ProofAge-Sdk: [<wrapper>/<version> ...] node/<package version>
 *   User-Agent:     ProofAge-Node/<package version> (Node <runtime version>)
 *
 * The same contract is implemented by the PHP, Laravel, WordPress and Shopify clients. The
 * header is not signed: HMAC stays METHOD + path + body.
 */
const packageVersion = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const ownToken = `node/${packageVersion}`;
const runtimeVersion = process.version.replace(/^v/, '');
const defaultUserAgent = `ProofAge-Node/${packageVersion} (Node ${runtimeVersion})`;

const baseConfig = {
  apiKey: 'test-api-key',
  secretKey: 'test-secret-key',
  baseUrl: 'https://api.test.com',
  version: 'v1',
  retryAttempts: 1,
};

function stubFetch(response: () => Response = () => new Response(JSON.stringify({ id: 'x' }), { status: 200 })) {
  const spy = vi.fn(async () => Promise.resolve(response()));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function sentHeaders(spy: ReturnType<typeof vi.fn>, index = 0): Record<string, string> {
  const [, init] = spy.mock.calls[index] as unknown as [string, RequestInit];
  return init.headers as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SDK_VERSION', () => {
  it('matches package.json, so a release cannot ship a stale identification', () => {
    // `npm version` regenerates src/version.ts through the "version" lifecycle script.
    // If this fails, run `node scripts/sync-version.mjs`.
    expect(SDK_VERSION).toBe(packageVersion);
  });
});

describe('X-ProofAge-Sdk and User-Agent', () => {
  it('go out on a GET', async () => {
    const spy = stubFetch();

    await new ProofAgeClient(baseConfig).workspace().get();

    const headers = sentHeaders(spy);
    expect(headers['X-ProofAge-Sdk']).toBe(ownToken);
    expect(headers['User-Agent']).toBe(defaultUserAgent);
  });

  it('go out on a JSON POST', async () => {
    const spy = stubFetch();

    await new ProofAgeClient(baseConfig).verifications().create({ external_id: 'user-1' });

    const headers = sentHeaders(spy);
    expect(headers['X-ProofAge-Sdk']).toBe(ownToken);
    expect(headers['User-Agent']).toBe(defaultUserAgent);
  });

  it('go out on a multipart upload', async () => {
    const spy = stubFetch(() => new Response(null, { status: 200 }));

    await new ProofAgeClient(baseConfig).verifications('ver_1').uploadMedia({ type: 'selfie', file: Buffer.from('x') });

    const headers = sentHeaders(spy);
    expect(headers['X-ProofAge-Sdk']).toBe(ownToken);
    expect(headers['User-Agent']).toBe(defaultUserAgent);
  });

  it('go out on a media download', async () => {
    const spy = stubFetch(() => new Response('bytes', { status: 200 }));

    await new ProofAgeClient(baseConfig).verifications('ver_1').downloadMedia('med_1');

    const headers = sentHeaders(spy);
    expect(headers['X-ProofAge-Sdk']).toBe(ownToken);
    expect(headers['User-Agent']).toBe(defaultUserAgent);
  });

  it('go out on every retry attempt, not just the first', async () => {
    let calls = 0;
    const spy = stubFetch(() =>
      calls++ === 0
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify({ id: 'x' }), { status: 200 }),
    );

    await new ProofAgeClient({ ...baseConfig, retryAttempts: 2, retryDelay: 0 }).workspace().get();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(sentHeaders(spy, 1)['X-ProofAge-Sdk']).toBe(ownToken);
  });

  it('lets a wrapper prepend its own tokens, outermost first', async () => {
    const spy = stubFetch();

    await new ProofAgeClient({ ...baseConfig, sdkTokens: ['shopify-app/1.4.0', 'proofage-bridge/2.0.0-beta.1'] })
      .workspace()
      .get();

    expect(sentHeaders(spy)['X-ProofAge-Sdk']).toBe(`shopify-app/1.4.0 proofage-bridge/2.0.0-beta.1 ${ownToken}`);
  });

  it('keeps its own token when a wrapper passes none', async () => {
    const spy = stubFetch();

    await new ProofAgeClient({ ...baseConfig, sdkTokens: [] }).workspace().get();

    expect(sentHeaders(spy)['X-ProofAge-Sdk']).toBe(ownToken);
  });

  it('cannot have its own token replaced or duplicated by a wrapper', async () => {
    const spy = stubFetch();

    await new ProofAgeClient({ ...baseConfig, sdkTokens: ['shopify-app/1.4.0', 'node/9.9.9', 'Node/1.0.0'] })
      .workspace()
      .get();

    expect(sentHeaders(spy)['X-ProofAge-Sdk']).toBe(`shopify-app/1.4.0 ${ownToken}`);
  });

  it.each([
    ['no version', 'shopify-app'],
    ['empty version', 'shopify-app/'],
    ['empty name', '/1.0.0'],
    ['a space', 'shopify app/1.0.0'],
    ['two tokens in one', 'shopify-app/1.0.0 other/2.0.0'],
    ['two slashes', 'shopify/app/1.0.0'],
    ['a newline', 'shopify-app/1.0.0\r\nX-Evil: 1'],
    ['non-ASCII', 'шопифай/1.0.0'],
  ])('rejects a wrapper token with %s', (_label, token) => {
    expect(() => new ProofAgeClient({ ...baseConfig, sdkTokens: [token] })).toThrow(ProofAgeError);
  });

  it('keeps a caller-supplied User-Agent, and still identifies the SDK', async () => {
    const spy = stubFetch();

    await new ProofAgeClient({ ...baseConfig, userAgent: 'MyShop/3.1' }).workspace().get();

    const headers = sentHeaders(spy);
    expect(headers['User-Agent']).toBe('MyShop/3.1');
    expect(headers['X-ProofAge-Sdk']).toBe(ownToken);
  });

  it('omits the runtime from the User-Agent where there is no Node process', async () => {
    const spy = stubFetch();
    vi.stubGlobal('process', undefined);

    let client: ProofAgeClient;
    try {
      client = new ProofAgeClient(baseConfig);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('fetch', spy);
    }
    await client.workspace().get();

    expect(sentHeaders(spy)['User-Agent']).toBe(`ProofAge-Node/${packageVersion}`);
  });

  it('leaves the HMAC signature untouched: METHOD + path + body only', async () => {
    const spy = stubFetch();

    await new ProofAgeClient({ ...baseConfig, sdkTokens: ['shopify-app/1.4.0'], userAgent: 'MyShop/3.1' })
      .verifications()
      .create({ external_id: 'user-1' });

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const expected = generateHmacSignature('test-secret-key', 'POST', 'v1', 'verifications', init.body as string);
    expect(sentHeaders(spy)['X-HMAC-Signature']).toBe(expected);
  });
});
