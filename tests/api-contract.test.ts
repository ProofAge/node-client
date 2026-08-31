import { readFileSync } from 'node:fs';
import { BLOCK_FACE_REASON_CODES } from '../src/types.js';
import { describe, expect, it } from 'vitest';

interface OperationContract {
  method: string;
  path: string;
  request: string[];
  response: string[];
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
    request: ['fingerprint', 'callback_url', 'external_id', 'external_metadata', 'metadata'],
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
    ],
  },
  'verifications.acceptConsent': {
    method: 'POST',
    path: '/verifications/{verification}/consent',
    request: ['consent_version_id', 'text_sha256', 'device', 'in_app_browser', 'in_iframe', 'referrer', 'camera_permission', 'camera_policy_allowed'],
    response: ['consent_version_id', 'consent_accepted_at'],
  },
  'verifications.uploadMedia': {
    method: 'POST',
    path: '/verifications/{verification}/media',
    request: ['file', 'type', 'side', 'document', 'fingerprint', 'head_turn_step', 'capture_resolution', 'device_info', 'liveness_telemetry'],
    response: ['message'],
  },
  'verifications.submit': {
    method: 'POST',
    path: '/verifications/{verification}/submit',
    request: [],
    response: ['message'],
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

/** Top-level property names of an OpenAPI schema, resolving $ref and merging allOf. */
function schemaProperties(schema: Json): string[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  if (schema.$ref) {
    const name = String(schema.$ref).replace('#/components/schemas/', '');
    return schemaProperties(spec.components?.schemas?.[name]);
  }
  let props: string[] = [];
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      props = props.concat(schemaProperties(sub));
    }
  }
  if (schema.properties && typeof schema.properties === 'object') {
    props = props.concat(Object.keys(schema.properties));
  }
  return [...new Set(props)];
}

function requestProperties(path: string, method: string): string[] {
  const op = spec.paths[path]?.[method.toLowerCase()];
  return schemaProperties(op?.requestBody?.content?.['application/json']?.schema ?? {});
}

function responseProperties(path: string, method: string): string[] {
  const op = spec.paths[path]?.[method.toLowerCase()];
  const responses: Record<string, Json> = op?.responses ?? {};
  for (const [code, resp] of Object.entries(responses)) {
    if (!code.startsWith('2')) {
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
      const props = responseProperties(op.path, op.method);
      if (props.length === 0) {
        // Scramble cannot describe this response; its shape is pinned by the
        // authored interface in src/types.ts and the client tests instead.
        continue;
      }
      expect(sorted(props), `response fields for [${name}]`).toEqual(sorted(op.response));
      checked.push(name);
    }
    expect(sorted(checked)).toEqual(['verifications.document', 'verifications.estimation', 'verifications.find', 'workspace.get']);
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
});
