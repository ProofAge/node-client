import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildApiPath,
  canonicalizeArrayForQuery,
  generateHmacSignature,
  generateHmacSignatureForFiles,
  phpHttpBuildQueryRfc3986,
  serializeJsonBody,
} from '../src/hmac.js';

describe('serializeJsonBody', () => {
  it('returns empty string for empty object', () => {
    expect(serializeJsonBody({})).toBe('');
  });

  it('returns JSON string for non-empty object', () => {
    expect(serializeJsonBody({ a: 1 })).toBe('{"a":1}');
  });

  it('serializes nested data', () => {
    const data = { callback_url: 'https://x.com', metadata: { foo: 'bar' } };
    expect(serializeJsonBody(data)).toBe(JSON.stringify(data));
  });
});

describe('buildApiPath', () => {
  it('builds path with version', () => {
    expect(buildApiPath('v1', 'workspace')).toBe('/v1/workspace');
  });

  it('strips leading slash from endpoint', () => {
    expect(buildApiPath('v1', '/verifications')).toBe('/v1/verifications');
  });
});

describe('canonicalizeArrayForQuery', () => {
  it('sorts keys', () => {
    const result = canonicalizeArrayForQuery({ z: 1, a: 2, m: 3 });
    expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
  });

  it('sorts nested keys recursively', () => {
    const result = canonicalizeArrayForQuery({ b: { y: 1, x: 2 }, a: 0 });
    expect(Object.keys(result)).toEqual(['a', 'b']);
    expect(Object.keys(result.b as Record<string, unknown>)).toEqual(['x', 'y']);
  });
});

describe('phpHttpBuildQueryRfc3986', () => {
  it('encodes simple fields', () => {
    expect(phpHttpBuildQueryRfc3986({ type: 'selfie' })).toBe('type=selfie');
  });

  it('sorts fields', () => {
    expect(phpHttpBuildQueryRfc3986({ z: '1', a: '2' })).toBe('a=2&z=1');
  });

  it('encodes nested objects', () => {
    const result = phpHttpBuildQueryRfc3986({ meta: { user_id: '42' } });
    expect(result).toBe('meta%5Buser_id%5D=42');
  });

  it('encodes arrays', () => {
    const result = phpHttpBuildQueryRfc3986({ tags: ['a', 'b'] });
    expect(result).toBe('tags%5B0%5D=a&tags%5B1%5D=b');
  });

  it('skips null values (matches PHP)', () => {
    const result = phpHttpBuildQueryRfc3986({ a: '1', b: null, c: '3' });
    expect(result).toBe('a=1&c=3');
  });

  it('encodes booleans as 1/0 (matches PHP)', () => {
    const result = phpHttpBuildQueryRfc3986({ active: true, deleted: false });
    expect(result).toBe('active=1&deleted=0');
  });

  it('returns empty string for empty object', () => {
    expect(phpHttpBuildQueryRfc3986({})).toBe('');
  });
});

describe('generateHmacSignature', () => {
  it('matches Laravel ProofAgeClientTest canonical string', () => {
    const secret = 'test-secret-key';
    const data = { callback_url: 'https://example.com/webhook' };
    const rawBody = serializeJsonBody(data);
    const sig = generateHmacSignature(secret, 'POST', 'v1', 'verifications', rawBody);

    const expectedCanonical = `POST/v1/verifications${rawBody}`;
    const expected = createHmac('sha256', secret).update(expectedCanonical, 'utf8').digest('hex');

    expect(sig).toBe(expected);
    expect(sig.length).toBe(64);
  });

  it('produces deterministic output for GET with empty body', () => {
    const secret = 'test-secret-key';
    const sig = generateHmacSignature(secret, 'GET', 'v1', 'workspace', '');

    const expectedCanonical = 'GET/v1/workspace';
    const expected = createHmac('sha256', secret).update(expectedCanonical, 'utf8').digest('hex');

    expect(sig).toBe(expected);
  });

  it('cross-language fixture: exact signature from Laravel test', () => {
    // Reproduces ProofAgeClientTest::test_it_generates_correct_hmac_signature_for_json_data
    // PHP: hash_hmac('sha256', 'POST/v1/verifications{"callback_url":"https://example.com/webhook"}', 'test-secret-key')
    const secret = 'test-secret-key';
    const rawBody = '{"callback_url":"https://example.com/webhook"}';
    const canonical = `POST/v1/verifications${rawBody}`;
    const expected = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');

    const sig = generateHmacSignature(secret, 'POST', 'v1', 'verifications', rawBody);
    expect(sig).toBe(expected);
    // Known PHP output for this input (run php -r "echo hash_hmac('sha256', 'POST/v1/verifications{\"callback_url\":\"https://example.com/webhook\"}', 'test-secret-key');")
    expect(sig).toBe('36b3b4817df54d6ddd794d614a30ce1e0d31ca27201151853d15a422610fd417');
  });
});

describe('generateHmacSignatureForFiles', () => {
  it('builds multipart canonical with sorted file hashes', () => {
    const secret = 'test-secret-key';
    const bufA = Buffer.from('a');
    const bufB = Buffer.from('bb');
    const sig = generateHmacSignatureForFiles(secret, 'POST', 'v1', 'verifications/ver_123/media', { type: 'selfie' }, [
      bufA,
      bufB,
    ]);

    const fieldsString = phpHttpBuildQueryRfc3986({ type: 'selfie' });
    expect(fieldsString).toBe('type=selfie');

    const ha = createHash('sha256').update(bufA).digest('hex');
    const hb = createHash('sha256').update(bufB).digest('hex');
    const sorted = [ha, hb].sort().join(',');
    const canonical = `POST/v1/verifications/ver_123/media\n${fieldsString}\n${sorted}`;
    const expected = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
    expect(sig).toBe(expected);
  });
});
