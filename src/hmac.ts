import { createHash, createHmac } from 'node:crypto';

/**
 * Serialize request body for signing. Matches Laravel `json_encode($data)` for plain objects (ASCII payloads).
 */
export function serializeJsonBody(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) {
    return '';
  }
  return JSON.stringify(data);
}

export function buildApiPath(version: string, endpoint: string): string {
  return `/${version}/${endpoint.replace(/^\//, '')}`;
}

/**
 * HMAC for JSON/non-file requests.
 * Canonical: METHOD + path + rawJsonBody (see ProofAge Laravel client).
 */
export function generateHmacSignature(
  secretKey: string,
  method: string,
  version: string,
  endpoint: string,
  rawBody: string,
): string {
  const m = method.toUpperCase();
  const path = buildApiPath(version, endpoint);
  const canonicalRequest = `${m}${path}${rawBody}`;
  return createHmac('sha256', secretKey).update(canonicalRequest, 'utf8').digest('hex');
}

/**
 * Recursively ksort-like ordering for PHP-compatible query building.
 */
export function canonicalizeArrayForQuery(input: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(input).sort();
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    const v = input[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) {
      result[k] = canonicalizeArrayForQuery(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * PHP `http_build_query($data, '', '&', PHP_QUERY_RFC3986)` for nested arrays/objects.
 * Field order follows k-sorted keys at each level (same as Laravel client).
 */
export function phpHttpBuildQueryRfc3986(data: Record<string, unknown>): string {
  const parts: string[] = [];

  function walk(prefix: string, value: unknown): void {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'boolean') {
      parts.push(`${encodeURIComponent(prefix)}=${value ? '1' : '0'}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        walk(`${prefix}[${i}]`, item);
      });
      return;
    }
    if (typeof value === 'object' && !(value instanceof Uint8Array) && !Buffer.isBuffer(value)) {
      const o = value as Record<string, unknown>;
      for (const k of Object.keys(o).sort()) {
        walk(`${prefix}[${k}]`, o[k]);
      }
      return;
    }
    parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }

  const sorted = canonicalizeArrayForQuery(data);
  for (const k of Object.keys(sorted).sort()) {
    const v = sorted[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array) && !Buffer.isBuffer(v)) {
      walk(`${k}`, v);
    } else if (Array.isArray(v)) {
      walk(`${k}`, v);
    } else {
      walk(k, v);
    }
  }

  return parts.join('&');
}

export function sha256Hex(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * HMAC for multipart (file) requests.
 * Canonical: METHOD + path + "\n" + fieldsString + "\n" + comma-sorted file hashes
 */
export function generateHmacSignatureForFiles(
  secretKey: string,
  method: string,
  version: string,
  endpoint: string,
  formFields: Record<string, unknown>,
  fileBuffers: Buffer[],
): string {
  const m = method.toUpperCase();
  const path = buildApiPath(version, endpoint);
  const fieldsString = phpHttpBuildQueryRfc3986(canonicalizeArrayForQuery(formFields));
  const fileHashes = fileBuffers.map((b) => sha256Hex(b)).sort();
  const canonicalRequest = `${m}${path}\n${fieldsString}\n${fileHashes.join(',')}`;
  return createHmac('sha256', secretKey).update(canonicalRequest, 'utf8').digest('hex');
}
