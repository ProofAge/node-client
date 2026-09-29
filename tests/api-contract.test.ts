import { readFileSync } from 'node:fs';
import { BLOCK_FACE_REASON_CODES } from '../src/types.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ConsentInfo } from '../src/types.js';

interface OperationContract {
  method: string;
  path: string;
  request: string[];
  /** Top-level response fields; empty when the SDK resolves the call to null or a stream. */
  response: string[];
  /**
   * The success status whose body the SDK receives, when the operation documents more than
   * one. createVerification also documents a 200 compact session response, sent only to the
   * hosted widget's native-client header, which this SDK never sends.
   */
  responseStatus?: string;
}

/**
 * SDK method -> API operation contract. `path` matches the bundled openapi.json path
 * template (no version prefix). `request`/`response` are the top-level field-name sets the
 * SDK exchanges; the response sets are the authoritative (authored) contract and double as
 * the source for the response interfaces in src/types.ts and for AGENTS.md.
 */
const OPERATIONS: Record<string, OperationContract> = {
  'workspace.get': {
    method: 'GET',
    path: '/workspace',
    request: [],
    response: [
      'id',
      'name',
      'flow_type',
      'mode',
      'age_mode',
      'age_threshold',
      'verification_type',
      'redirect_url',
      'webhook_url',
      'allow_expired_documents',
      'allow_duplicate_accounts',
    ],
  },
  'workspace.getConsent': {
    method: 'GET',
    path: '/consent',
    request: [],
    response: ['id', 'version', 'text_sha256', 'url'],
  },
  'verifications.create': {
    method: 'POST',
    path: '/verifications',
    request: ['callback_url', 'external_id', 'external_metadata', 'metadata'],
    responseStatus: '201',
    response: [
      'id',
      'external_id',
      'external_metadata',
      'redirect_url',
      'status',
      'reason',
      'duplicate_check',
      'erasure',
      'consent_accepted_at',
      'created_at',
      'updated_at',
      'url',
    ],
  },
  'verifications.find': {
    method: 'GET',
    path: '/verifications/{verification}',
    request: [],
    response: [
      'id',
      'external_id',
      'external_metadata',
      'redirect_url',
      'status',
      'reason',
      'consent_accepted_at',
      'created_at',
      'updated_at',
      'duplicate_check',
      'erasure',
    ],
  },
  'verifications.acceptConsent': {
    method: 'POST',
    path: '/verifications/{verification}/consent',
    request: ['consent_version_id', 'text_sha256'],
    response: ['consent_version_id', 'consent_accepted_at'],
  },
  'verifications.uploadMedia': {
    method: 'POST',
    path: '/verifications/{verification}/media',
    request: ['file', 'type', 'side', 'document'],
    response: [],
  },
  'verifications.submit': {
    method: 'POST',
    path: '/verifications/{verification}/submit',
    request: [],
    response: [],
  },
  'verifications.document': {
    method: 'GET',
    path: '/verifications/{verification}/document',
    request: [],
    response: ['document', 'media', 'meta'],
  },
  'verifications.downloadMedia': {
    method: 'GET',
    path: '/verifications/{verification}/media/{media}',
    request: [],
    response: [],
  },
  'verifications.estimation': {
    method: 'GET',
    path: '/verifications/{verification}/estimation',
    request: [],
    response: ['verification_id', 'attempt_id', 'age_threshold', 'gender'],
  },
  'verifications.blockFace': {
    method: 'POST',
    path: '/verifications/{verification}/blocked-face',
    request: ['reason', 'reason_code'],
    response: [],
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, Json>>;
  components?: { schemas?: Record<string, Json> };
};

/**
 * Top-level property names of an OpenAPI schema, resolving $ref and merging allOf, anyOf and
 * oneOf (a union contributes every field any branch can carry).
 */
function schemaProperties(schema: Json): string[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  if (schema.$ref) {
    const name = String(schema.$ref).replace('#/components/schemas/', '');
    return schemaProperties(spec.components?.schemas?.[name]);
  }
  let props: string[] = [];
  for (const combinator of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[combinator])) {
      for (const sub of schema[combinator]) {
        props = props.concat(schemaProperties(sub));
      }
    }
  }
  if (schema.properties && typeof schema.properties === 'object') {
    props = props.concat(Object.keys(schema.properties));
  }
  return [...new Set(props)];
}

function requestProperties(path: string, method: string): string[] {
  const content = spec.paths[path]?.[method.toLowerCase()]?.requestBody?.content ?? {};
  return schemaProperties(content['application/json']?.schema ?? content['multipart/form-data']?.schema ?? {});
}

function responseProperties(path: string, method: string, status?: string): string[] {
  const op = spec.paths[path]?.[method.toLowerCase()];
  const responses: Record<string, Json> = op?.responses ?? {};
  for (const [code, resp] of Object.entries(responses)) {
    if (!code.startsWith('2') || (status !== undefined && code !== status)) {
      continue;
    }
    const schema = resp?.content?.['application/json']?.schema;
    if (!schema) {
      continue;
    }
    return schemaProperties(schema);
  }
  return [];
}

const sorted = (xs: string[]): string[] => [...xs].sort();

describe('API contract drift', () => {
  it('every SDK operation exists in the bundled spec', () => {
    for (const [name, op] of Object.entries(OPERATIONS)) {
      const specOp = spec.paths[op.path]?.[op.method.toLowerCase()];
      expect(specOp, `SDK method [${name}] targets ${op.method} ${op.path}, missing from the spec`).toBeTruthy();
    }
  });

  it('every spec operation is covered by an SDK method', () => {
    const mapped = new Set(Object.values(OPERATIONS).map((o) => `${o.method.toUpperCase()} ${o.path}`));
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        const key = `${method.toUpperCase()} ${path}`;
        expect(mapped.has(key), `Spec exposes ${key} but no SDK method covers it`).toBe(true);
      }
    }
  });

  it('request fields match the spec', () => {
    for (const [name, op] of Object.entries(OPERATIONS)) {
      if (op.request.length === 0) {
        continue;
      }
      expect(sorted(requestProperties(op.path, op.method)), `request fields for [${name}]`).toEqual(sorted(op.request));
    }
  });

  it('response fields match the spec for describable endpoints', () => {
    const checked: string[] = [];
    for (const [name, op] of Object.entries(OPERATIONS)) {
      const props = responseProperties(op.path, op.method, op.responseStatus);
      if (props.length === 0) {
        // Scramble cannot describe this response; its shape is pinned by the
        // authored interface in src/types.ts and the client tests instead.
        continue;
      }
      expect(sorted(props), `response fields for [${name}]`).toEqual(sorted(op.response));
      checked.push(name);
    }
    expect(sorted(checked)).toEqual([
      'verifications.acceptConsent',
      'verifications.create',
      'verifications.document',
      'verifications.estimation',
      'verifications.find',
      'workspace.get',
      'workspace.getConsent',
    ]);
  });

  it('the calls the SDK resolves to null answer without a JSON body', () => {
    for (const name of ['verifications.uploadMedia', 'verifications.submit', 'verifications.blockFace']) {
      const op = OPERATIONS[name]!;
      const responses: Record<string, Json> = spec.paths[op.path]?.[op.method.toLowerCase()]?.responses ?? {};
      const success = Object.entries(responses).filter(([code]) => code.startsWith('2'));
      expect(success.length, `[${name}] documents no success response`).toBeGreaterThan(0);
      for (const [code, resp] of success) {
        expect(resp?.content?.['application/json'], `[${name}] ${code} carries a JSON body`).toBeUndefined();
      }
    }
  });

  it('AGENTS.md documents every endpoint', () => {
    const doc = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
    for (const [name, op] of Object.entries(OPERATIONS)) {
      const token = `${op.method} ${op.path}`;
      expect(doc.includes(token), `AGENTS.md missing [${name}] (${token})`).toBe(true);
    }
  });
  it('the reason codes the SDK offers are the ones the API accepts', () => {
    // A sixth code added upstream must not sit unnoticed in a union that
    // silently rejects it at the type level.
    expect(BLOCK_FACE_REASON_CODES).toEqual(
      (spec.components as { schemas: Record<string, { enum: string[] }> }).schemas.BlockedFaceReasonCode.enum,
    );
  });

  it('types the consent version as the integer the API sends', () => {
    // Scramble documents field types, and the SDK's interfaces must follow them: the
    // name-only checks above let `version: string` drift from the API's integer.
    const schema = spec.paths['/consent']?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(schema?.properties?.version?.type).toBe('integer');
    expectTypeOf<ConsentInfo['version']>().toEqualTypeOf<number>();
  });
});
