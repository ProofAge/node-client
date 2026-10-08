import { readFileSync } from 'node:fs';
import {
  BLOCK_FACE_REASON_CODES,
  LIST_VERIFICATIONS_STATUSES,
  TEST_VERIFICATION_OUTCOMES,
  WEBHOOK_SUBSCRIPTION_STATUSES,
} from '../src/types.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ConsentInfo } from '../src/types.js';

interface OperationContract {
  method: string;
  path: string;
  request: string[];
  /** Query parameters, for the operations that take them. */
  query?: string[];
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
  'verifications.list': {
    method: 'GET',
    path: '/verifications',
    request: [],
    query: ['status', 'external_id', 'limit', 'cursor'],
    response: ['data', 'next_cursor'],
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
  'verifications.setTestOutcome': {
    method: 'POST',
    path: '/verifications/{verification}/test-outcome',
    request: ['status', 'reason'],
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
  'verifications.blockFace': {
    method: 'POST',
    path: '/verifications/{verification}/blocked-face',
    request: ['reason', 'reason_code'],
    response: [],
  },
  'webhookSubscriptions.create': {
    method: 'POST',
    path: '/webhook-subscriptions',
    request: ['url', 'statuses', 'include_document_data'],
    responseStatus: '201',
    response: ['id', 'url', 'statuses', 'include_document_data', 'created_at'],
  },
  'webhookSubscriptions.list': {
    method: 'GET',
    path: '/webhook-subscriptions',
    request: [],
    response: ['data'],
  },
  'webhookSubscriptions.delete': {
    method: 'DELETE',
    path: '/webhook-subscriptions/{subscription}',
    request: [],
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

function responseSchema(path: string, method: string, status?: string): Json {
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
    return schema;
  }
  return undefined;
}

function responseProperties(path: string, method: string, status?: string): string[] {
  return schemaProperties(responseSchema(path, method, status));
}

/** Field names of the items of a list response's `data` array. */
function dataItemProperties(path: string, method: string): string[] {
  return schemaProperties(responseSchema(path, method)?.properties?.data?.items);
}

function queryParameters(path: string, method: string): string[] {
  const params: Json[] = spec.paths[path]?.[method.toLowerCase()]?.parameters ?? [];
  return params.filter((p) => p.in === 'query').map((p) => String(p.name));
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

  it('query parameters match the spec', () => {
    for (const [name, op] of Object.entries(OPERATIONS)) {
      expect(sorted(queryParameters(op.path, op.method)), `query parameters for [${name}]`).toEqual(
        sorted(op.query ?? []),
      );
    }
  });

  it('a listed verification has the shape find() returns', () => {
    expect(sorted(dataItemProperties('/verifications', 'GET'))).toEqual(sorted(OPERATIONS['verifications.find']!.response));
  });

  it('a listed webhook subscription has the shape create() returns', () => {
    expect(sorted(dataItemProperties('/webhook-subscriptions', 'GET'))).toEqual(
      sorted(OPERATIONS['webhookSubscriptions.create']!.response),
    );
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
      'verifications.list',
      'verifications.setTestOutcome',
      'webhookSubscriptions.create',
      'webhookSubscriptions.list',
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

  it('a webhook subscription is deleted with an empty 204', () => {
    // Scramble attaches a `string` JSON schema to the 204; a 204 carries no body whatever it says.
    const responses: Record<string, Json> =
      spec.paths['/webhook-subscriptions/{subscription}']?.delete?.responses ?? {};
    expect(Object.keys(responses).filter((code) => code.startsWith('2'))).toEqual(['204']);
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

  it('the statuses list() filters on are the ones the API accepts', () => {
    // The parameter's description names every accepted status, plus documents_required, which
    // is listed but not stored, so it is not a filter value.
    const param = spec.paths['/verifications']?.get?.parameters?.find((p: Json) => p.name === 'status');
    const named = new Set([...String(param?.description).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
    named.delete('documents_required');
    expect(sorted([...named] as string[])).toEqual(sorted([...LIST_VERIFICATIONS_STATUSES]));
  });

  it('the outcomes setTestOutcome() offers are the ones the API accepts', () => {
    expect(TEST_VERIFICATION_OUTCOMES).toEqual(
      spec.components?.schemas?.SetTestVerificationOutcomeRequest?.properties?.status?.enum,
    );
  });

  it('the statuses a webhook subscription takes are the ones the API accepts', () => {
    expect(WEBHOOK_SUBSCRIPTION_STATUSES).toEqual(
      spec.components?.schemas?.StoreWebhookSubscriptionRequest?.properties?.statuses?.items?.enum,
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
