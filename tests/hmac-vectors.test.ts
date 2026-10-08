import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateHmacSignature, generateHmacSignatureForFiles, withQuery } from '../src/hmac.js';
import { verifyWebhookSignature } from '../src/webhook.js';

/**
 * Golden HMAC vectors shared by every ProofAge SDK. The fixture is a verbatim copy of
 * `resources/hmac-vectors.json` from proofage/php-sdk, and the app's
 * tests/Feature/API/HmacVectorsTest.php runs the same file through its real
 * VerifyHmacSignature middleware — so a vector passing here means the server accepts the
 * signature. Refresh the copy when that file changes; never edit it by hand.
 */
interface Vectors {
  secret: string;
  json: Array<{
    name: string;
    method: string;
    path: string;
    query?: string;
    body: string;
    canonical: string;
    expected: string;
  }>;
  multipart: Array<{
    name: string;
    method: string;
    path: string;
    fields: Record<string, unknown>;
    files: Array<{ content_base64: string }>;
    expected: string;
  }>;
  webhook: Array<{ name: string; timestamp: number; payload: string; expected: string; expected_canonical?: string }>;
}

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/hmac-vectors.json', import.meta.url), 'utf8'),
) as Vectors;

function splitPath(path: string): { version: string; endpoint: string } {
  const [, version, ...rest] = path.split('/');
  return { version: version!, endpoint: rest.join('/') };
}

describe('shared HMAC vectors', () => {
  describe('JSON requests', () => {
    for (const v of vectors.json) {
      it(v.name, () => {
        const { version, endpoint } = splitPath(v.path);
        // A vector's query is what some client might send. The SDK rebuilds it from its
        // parameters (URLSearchParams decodes `+` as a space, as PHP does), and the string it
        // builds is the one it both requests and signs, so it must match the canonical form.
        const signed =
          v.query === undefined ? endpoint : withQuery(endpoint, Object.fromEntries(new URLSearchParams(v.query)));
        expect(`${v.method.toUpperCase()}/${version}/${signed}${v.body}`).toBe(v.canonical);
        expect(generateHmacSignature(vectors.secret, v.method, version, signed, v.body)).toBe(v.expected);
      });
    }
  });

  describe('multipart requests', () => {
    for (const v of vectors.multipart) {
      it(v.name, () => {
        const { version, endpoint } = splitPath(v.path);
        const files = v.files.map((f) => Buffer.from(f.content_base64, 'base64'));
        expect(generateHmacSignatureForFiles(vectors.secret, v.method, version, endpoint, v.fields, files)).toBe(
          v.expected,
        );
      });
    }
  });

  describe('webhooks', () => {
    for (const v of vectors.webhook) {
      it(v.name, () => {
        const verify = (signature: string): void =>
          verifyWebhookSignature({
            rawBody: v.payload,
            signature,
            timestamp: v.timestamp,
            authClient: 'pk',
            apiKey: 'pk',
            secretKey: vectors.secret,
            tolerance: Number.MAX_SAFE_INTEGER,
          });

        expect(() => verify(v.expected)).not.toThrow();
        if (v.expected_canonical) {
          expect(() => verify(v.expected_canonical!)).not.toThrow();
        }
      });
    }
  });
});
