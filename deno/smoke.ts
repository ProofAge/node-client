/**
 * Runs the packed @proofage/node under Deno, the way a Supabase Edge Function loads it:
 * as npm package code, not as source. It checks what the SDK needs from the runtime —
 * node:crypto, Buffer, process.env and fetch — on real calls:
 *
 *   1. the shared HMAC vectors (the server accepts these exact signatures);
 *   2. a signed create against a local stand-in for the API, keys from the environment
 *      and passed explicitly, with the SDK identification header;
 *   3. webhookHandler accepting a signed delivery and refusing a tampered one.
 *
 * Run by scripts/deno-smoke.sh; it is not part of the npm package.
 */
import {
  generateHmacSignature,
  generateWebhookSignature,
  ProofAgeClient,
  SDK_VERSION,
  webhookHandler,
} from '@proofage/node';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Deno smoke test failed: ${message}`);
  }
}

const API_KEY = 'pk_test_deno_smoke';
const SECRET_KEY = 'sk_test_deno_smoke';

// 1. Shared HMAC vectors.
interface Vectors {
  secret: string;
  json: Array<{ name: string; method: string; path: string; query?: string; body: string; expected: string }>;
}

const vectors = JSON.parse(
  await Deno.readTextFile(new URL('../tests/fixtures/hmac-vectors.json', import.meta.url)),
) as Vectors;

let checkedVectors = 0;
for (const vector of vectors.json) {
  if (vector.query) {
    continue; // the vitest suite covers query normalisation; the crypto is the same call
  }
  const [, version, ...rest] = vector.path.split('/');
  const signature = generateHmacSignature(vectors.secret, vector.method, version!, rest.join('/'), vector.body);
  check(signature === vector.expected, `HMAC vector "${vector.name}"`);
  checkedVectors++;
}
check(checkedVectors > 0, 'no HMAC vector was checked');

// 2. A signed create against a local stand-in for the API.
const seen: Array<{ apiKey: string | null; sdk: string | null; signatureValid: boolean }> = [];

const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (request) => {
  const url = new URL(request.url);
  const body = await request.text();
  const [, version, ...rest] = url.pathname.split('/');
  const expected = generateHmacSignature(SECRET_KEY, request.method, version!, rest.join('/'), body);

  seen.push({
    apiKey: request.headers.get('x-api-key'),
    sdk: request.headers.get('x-proofage-sdk'),
    signatureValid: request.headers.get('x-hmac-signature') === expected,
  });

  if (request.method !== 'POST' || url.pathname !== '/v1/verifications') {
    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
  }

  const payload = JSON.parse(body) as { external_id: string };

  return Response.json(
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      external_id: payload.external_id,
      status: 'created',
      url: 'https://idv.proofage.net/q/AB12cd34Ef',
    },
    { status: 201, headers: { Date: new Date().toUTCString() } },
  );
});

const baseUrl = `http://127.0.0.1:${server.addr.port}`;

try {
  // Keys passed explicitly, as the docs show for Deno.
  const explicit = new ProofAgeClient({ apiKey: API_KEY, secretKey: SECRET_KEY, baseUrl });
  const created = await explicit.verifications().create({ external_id: 'user_1' });
  check(created?.url === 'https://idv.proofage.net/q/AB12cd34Ef', 'create returned the verification url');

  // Keys read from the environment, as on Node.
  Deno.env.set('PROOFAGE_API_KEY', API_KEY);
  Deno.env.set('PROOFAGE_SECRET_KEY', SECRET_KEY);
  Deno.env.set('PROOFAGE_BASE_URL', `${baseUrl}/v1`); // a trailing /v1 is accepted
  const fromEnv = new ProofAgeClient();
  const createdFromEnv = await fromEnv.verifications().create({ external_id: 'user_2' });
  check(createdFromEnv?.external_id === 'user_2', 'create with keys from the environment');

  check(seen.length === 2, `expected 2 requests, the stand-in saw ${seen.length}`);
  for (const request of seen) {
    check(request.apiKey === API_KEY, 'X-API-Key is the public key');
    check(request.signatureValid, 'X-HMAC-Signature matches the request');
    check(request.sdk?.startsWith(`node/${SDK_VERSION}`), `X-ProofAge-Sdk names node/${SDK_VERSION}`);
  }
} finally {
  await server.shutdown();
}

// 3. Webhook verification.
const delivery = { event: 'verification.updated', data: { id: '550e8400-e29b-41d4-a716-446655440000', status: 'approved' } };
const timestamp = Math.floor(Date.now() / 1000);
const deliverySignature = generateWebhookSignature(delivery, SECRET_KEY, timestamp);

const received: unknown[] = [];
const handler = webhookHandler((payload) => {
  received.push(payload);
}, { apiKey: API_KEY, secretKey: SECRET_KEY });

const webhookRequest = (signature: string) =>
  new Request('http://localhost/webhooks/proofage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Client': API_KEY,
      'X-HMAC-Signature': signature,
      'X-Timestamp': String(timestamp),
    },
    body: JSON.stringify(delivery),
  });

const accepted = await handler(webhookRequest(deliverySignature));
check(accepted.status === 200, `a signed webhook is accepted (got ${accepted.status})`);
check(received.length === 1, 'the handler received the payload');

const refused = await handler(webhookRequest('0'.repeat(64)));
check(refused.status === 401, `a tampered webhook is refused (got ${refused.status})`);
check(received.length === 1, 'the handler did not run for a tampered webhook');

console.log(`@proofage/node ${SDK_VERSION} works on Deno ${Deno.version.deno}: ${checkedVectors} HMAC vectors, signed create, webhook handler.`);
