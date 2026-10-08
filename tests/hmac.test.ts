import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildApiPath,
  buildQueryString,
  canonicalizeArrayForQuery,
  generateHmacSignature,
  generateHmacSignatureForFiles,
  phpHttpBuildQueryRfc3986,
  rawUrlEncode,
  serializeJsonBody,
  toMultipartFields,
  withQuery,
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

  it("encodes ! ' ( ) * like PHP rawurlencode", () => {
    expect(phpHttpBuildQueryRfc3986({ note: "it's (a)*b!~" })).toBe('note=it%27s%20%28a%29%2Ab%21~');
  });
});

describe('rawUrlEncode', () => {
  it('matches PHP rawurlencode on every printable ASCII character', () => {
    // php -r 'echo rawurlencode(implode("", array_map("chr", range(32, 126))));'
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    expect(rawUrlEncode(ascii)).toBe(
      '%20%21%22%23%24%25%26%27%28%29%2A%2B%2C-.%2F0123456789%3A%3B%3C%3D%3E%3F%40ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D~',
    );
  });

  it('encodes UTF-8 bytes', () => {
    expect(rawUrlEncode('Jürgen')).toBe('J%C3%BCrgen');
  });
});

describe('toMultipartFields', () => {
  it('drops null and undefined', () => {
    expect(toMultipartFields({ a: 'x', b: null, c: undefined })).toEqual({ a: 'x' });
  });

  it('keeps empty strings (the API receives and signs them as-is)', () => {
    expect(toMultipartFields({ a: '' })).toEqual({ a: '' });
  });

  it('stringifies numbers and sends booleans as 1/0', () => {
    expect(toMultipartFields({ step: 3, ratio: 0.5, on: true, off: false })).toEqual({
      step: '3',
      ratio: '0.5',
      on: '1',
      off: '0',
    });
  });

  it('JSON-encodes objects and arrays', () => {
    expect(toMultipartFields({ device_info: { os: 'iOS' }, liveness_telemetry: [{ t_ms: 1 }] })).toEqual({
      device_info: '{"os":"iOS"}',
      liveness_telemetry: '[{"t_ms":1}]',
    });
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

describe('buildQueryString', () => {
  it('sorts keys and RFC 3986-encodes them as Symfony normalizeQueryString() does', () => {
    // PHP: Request::normalizeQueryString('status=approved,declined&limit=5&external_id=a b')
    expect(buildQueryString({ status: 'approved,declined', limit: 5, external_id: 'a b' })).toBe(
      'external_id=a%20b&limit=5&status=approved%2Cdeclined',
    );
  });

  it("encodes what encodeURIComponent leaves bare: ! ' ( ) *", () => {
    expect(buildQueryString({ q: "it's (a)*!~" })).toBe('q=it%27s%20%28a%29%2A%21~');
  });

  it('drops null and undefined parameters and sends booleans as 1/0', () => {
    expect(buildQueryString({ a: undefined, b: null, c: true, d: false, e: '' })).toBe('c=1&d=0&e=');
  });

  it('is empty when nothing is left, so no ? is appended', () => {
    expect(buildQueryString({ a: undefined })).toBe('');
    expect(withQuery('verifications', { a: undefined })).toBe('verifications');
    expect(withQuery('verifications', { limit: 2 })).toBe('verifications?limit=2');
  });

  it('signs the query as part of the path', () => {
    const endpoint = withQuery('verifications', { status: 'approved', limit: 10 });
    const expected = createHmac('sha256', 'sk')
      .update('GET/v1/verifications?limit=10&status=approved', 'utf8')
      .digest('hex');
    expect(generateHmacSignature('sk', 'GET', 'v1', endpoint, '')).toBe(expected);
  });
});
