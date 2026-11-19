import { AuthenticationError, ProofAgeError, ValidationError } from './errors.js';
import {
  generateHmacSignature,
  generateHmacSignatureForFiles,
  serializeJsonBody,
  toMultipartFields,
  withQuery,
} from './hmac.js';
import type { QueryValue } from './hmac.js';
import { VerificationResource } from './resources/verifications.js';
import { WebhookSubscriptionResource } from './resources/webhook-subscriptions.js';
import { buildSdkHeader, resolveUserAgent, SDK_HEADER } from './sdk-identification.js';
import { WorkspaceResource } from './resources/workspace.js';
import type { ApiErrorData, ProofAgeConfig } from './types.js';

const DEFAULT_BASE_URL = 'https://api.proofage.net';
const DEFAULT_VERSION = 'v1';

/** Methods that are safe to repeat after an ambiguous failure (5xx, timeout, dropped connection). */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);

/**
 * Network error codes raised before a single byte of the request reached the server
 * (no connection was ever established), so repeating even a POST cannot duplicate it.
 */
const NEVER_SENT_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * Accept header for downloads: the API renders errors as JSON only when the first
 * acceptable type is JSON, while a successful download streams the file regardless.
 */
const DOWNLOAD_ACCEPT = 'application/json, */*;q=0.8';

function errorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return undefined;
}

/**
 * True when a fetch() rejection certainly happened before the request was sent: DNS failed or
 * the connection was refused / never completed. undici reports these as `TypeError: fetch failed`
 * with the socket error as `cause` (an AggregateError when several addresses were tried).
 */
function failedBeforeSending(e: unknown): boolean {
  const cause = e && typeof e === 'object' && 'cause' in e ? (e as { cause: unknown }).cause : undefined;
  if (!cause) {
    return false;
  }
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    return cause.errors.every((inner) => NEVER_SENT_ERROR_CODES.has(errorCode(inner) ?? ''));
  }
  return NEVER_SENT_ERROR_CODES.has(errorCode(cause) ?? '');
}

/** Retry-After in milliseconds (delta-seconds or HTTP-date), or undefined when absent/unparseable. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

/** Error code of a 409 that says the first request with the same Idempotency-Key is still running. */
const IDEMPOTENCY_IN_PROGRESS = 'IDEMPOTENCY_KEY_IN_PROGRESS';

/** Error code of a 401 that says X-Timestamp is more than 300 s from the server's clock. */
const TIMESTAMP_OUT_OF_RANGE = 'TIMESTAMP_OUT_OF_RANGE';

/** Added to a wait for the next second, because a Node timer can fire a millisecond early. */
const SECOND_WAIT_MARGIN_MS = 50;

/** Error code of a 401 that says this exact signature was already used. */
const REPLAYED_REQUEST = 'REPLAYED_REQUEST';

/** What a request needs per attempt: the headers that depend on the clock, and the body. */
type AttemptRequest = {
  /** The `X-Timestamp` this attempt was signed with. */
  timestamp: string;
  headers: Record<string, string>;
  body: BodyInit | undefined;
};

/** Options of a single `makeRequest` call. */
export interface RequestOptions {
  /**
   * Sent as `Idempotency-Key`. Only the create calls (`POST /v1/verifications` and
   * `POST /v1/webhook-subscriptions`) honour it; a request that carries one is retried like a
   * GET, always with this same key and a fresh timestamp and signature.
   */
  idempotencyKey?: string;
}

/** The API accepts 1-255 printable ASCII characters (0x21-0x7E). */
function assertValidIdempotencyKey(key: string): void {
  if (!/^[\x21-\x7E]{1,255}$/.test(key)) {
    throw new TypeError('idempotencyKey must be 1-255 printable ASCII characters (no spaces)');
  }
}

/** The longest `Retry-After` a call waits for in-process; a longer one is thrown at once. */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Whether a 429 is worth repeating. One that names `Retry-After` is, when the wait is within the
 * cap. Without it, only the per-minute limiter's `RATE_LIMIT` (or a body that names no code)
 * is: a code such as `REAUTH_RATE_LIMITED` clears over 24 hours, so a retry cannot help.
 */
function retryable429(retryAfter: number | undefined, text: string): boolean {
  if (retryAfter !== undefined) {
    return retryAfter <= MAX_RETRY_AFTER_MS;
  }
  const code = parseErrorBody(text).errorData?.code;
  return code === undefined || code === 'RATE_LIMIT';
}

/**
 * Normalize the base URL to the API origin (plus any proxy path prefix), without the version.
 * A trailing `/{version}` — e.g. `https://api.proofage.net/v1` copied from the OpenAPI
 * `servers` entry — is stripped, because the client appends the version itself.
 */
function normalizeBaseUrl(raw: string, version: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProofAgeError(
      `Invalid baseUrl "${raw}": expected the API origin, e.g. https://api.proofage.net (without /${version})`,
      0,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProofAgeError(`Invalid baseUrl "${raw}": only http(s) URLs are supported`, 0);
  }
  if (url.search || url.hash) {
    throw new ProofAgeError(`Invalid baseUrl "${raw}": it must not carry a query string or fragment`, 0);
  }
  let path = url.pathname.replace(/\/+$/, '');
  const versionSuffix = `/${version.replace(/^\/+|\/+$/g, '')}`;
  if (path.endsWith(versionSuffix)) {
    path = path.slice(0, -versionSuffix.length);
  }
  return `${url.origin}${path}`;
}

/**
 * Pull `message`, `code` and field errors out of any of the API's error shapes:
 * `{ error: { code, message } }`, flat `{ code, message, ...extra }`, Laravel
 * `{ message, errors }` and `{ message }`.
 */
function parseErrorBody(text: string): {
  message?: string;
  errorData?: ApiErrorData;
  errors: Record<string, string[]>;
} {
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    return { errors: {} };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { errors: {} };
  }
  const body = parsed as Record<string, unknown>;
  const errors =
    body.errors && typeof body.errors === 'object' && !Array.isArray(body.errors)
      ? (body.errors as Record<string, string[]>)
      : {};

  if (body.error && typeof body.error === 'object' && !Array.isArray(body.error)) {
    const errorData = body.error as ApiErrorData;
    return {
      message: typeof errorData.message === 'string' ? errorData.message : undefined,
      errorData,
      errors,
    };
  }

  const { errors: _fieldErrors, ...rest } = body;
  const errorData = rest as ApiErrorData;
  return {
    message: typeof body.message === 'string' ? body.message : undefined,
    errorData: Object.keys(errorData).length > 0 ? errorData : undefined,
    errors,
  };
}

function envStr(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[key] : undefined;
}

function envInt(key: string): number | undefined {
  const v = envStr(key);
  if (v === undefined || v === '') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export class ProofAgeClient {
  private readonly config: Required<
    Pick<ProofAgeConfig, 'apiKey' | 'secretKey' | 'baseUrl' | 'version' | 'timeout' | 'retryAttempts' | 'retryDelay'>
  >;

  /** Milliseconds since the epoch; read on every attempt to stamp `X-Timestamp`. */
  private readonly clock: () => number;

  /**
   * Server time minus the local clock, in milliseconds, learned from the `Date` header of a
   * `TIMESTAMP_OUT_OF_RANGE` answer and applied to every later timestamp of this client.
   */
  private clockOffsetMs = 0;

  /**
   * `X-ProofAge-Sdk` and `User-Agent`, fixed at construction and sent on every request.
   * Neither is signed: the HMAC covers only method, path (with its query string) and body.
   */
  private readonly identificationHeaders: Readonly<Record<string, string>>;

  /**
   * Create a client configured entirely from environment variables.
   * Uses the same env names as the Laravel package (config/proofage.php):
   *   PROOFAGE_API_KEY, PROOFAGE_SECRET_KEY, PROOFAGE_BASE_URL,
   *   PROOFAGE_VERSION, PROOFAGE_TIMEOUT, PROOFAGE_RETRY_ATTEMPTS, PROOFAGE_RETRY_DELAY
   */
  static fromEnv(overrides: Partial<ProofAgeConfig> = {}): ProofAgeClient {
    return new ProofAgeClient(overrides);
  }

  constructor(config: ProofAgeConfig = {}) {
    const apiKey = config.apiKey ?? envStr('PROOFAGE_API_KEY');
    const secretKey = config.secretKey ?? envStr('PROOFAGE_SECRET_KEY');

    if (!apiKey) {
      throw new ProofAgeError('API key is required — set PROOFAGE_API_KEY or pass apiKey', 0);
    }
    if (!secretKey) {
      throw new ProofAgeError('Secret key is required — set PROOFAGE_SECRET_KEY or pass secretKey', 0);
    }

    const version = config.version ?? envStr('PROOFAGE_VERSION') ?? DEFAULT_VERSION;

    this.config = {
      apiKey,
      secretKey,
      baseUrl: normalizeBaseUrl(config.baseUrl ?? envStr('PROOFAGE_BASE_URL') ?? DEFAULT_BASE_URL, version),
      version,
      timeout: config.timeout ?? envInt('PROOFAGE_TIMEOUT') ?? 30_000,
      retryAttempts: config.retryAttempts ?? envInt('PROOFAGE_RETRY_ATTEMPTS') ?? 3,
      retryDelay: config.retryDelay ?? envInt('PROOFAGE_RETRY_DELAY') ?? 1000,
    };

    this.clock = config.clock ?? Date.now;

    this.identificationHeaders = {
      [SDK_HEADER]: buildSdkHeader(config.sdkTokens),
      'User-Agent': resolveUserAgent(config.userAgent),
    };
  }

  workspace(): WorkspaceResource {
    return new WorkspaceResource(this);
  }

  verifications(verificationId?: string): VerificationResource {
    return new VerificationResource(this, verificationId);
  }

  webhookSubscriptions(): WebhookSubscriptionResource {
    return new WebhookSubscriptionResource(this);
  }

  getConfig(): Readonly<typeof this.config> {
    return this.config;
  }

  /** Current Unix time in whole seconds, as the `X-Timestamp` header carries it. */
  private timestamp(): string {
    return String(this.currentSecond());
  }

  /** The (offset) clock in whole Unix seconds. */
  private currentSecond(): number {
    return Math.floor((this.clock() + this.clockOffsetMs) / 1000);
  }

  /**
   * Wait until the clock is in a different whole second than `previous`, the timestamp of the
   * attempt just made. A signature covers whole seconds, so a re-attempt of the same request in
   * the same second would repeat it and be refused as a replay. Timers can wake a little early,
   * so the wait carries a margin and the clock is checked again (a bounded number of times, in
   * case a test clock does not advance).
   */
  private async untilNewSecond(previous: number): Promise<void> {
    for (let i = 0; i < 10; i++) {
      if (this.currentSecond() !== previous) {
        return;
      }
      const intoSecond = (this.clock() + this.clockOffsetMs) % 1000;
      await this.delay(1000 - intoSecond + SECOND_WAIT_MARGIN_MS);
    }
  }

  /**
   * Send a signed request. `query` is built into the URL in the API's normalised form (sorted
   * keys, RFC 3986 encoding, `null`/`undefined` dropped), and that same string is signed.
   *
   * Every attempt, retries included, is stamped with the current time in `X-Timestamp` and signed
   * anew: the API accepts a timestamped request once, so a retry that reused the first
   * signature would be refused as a replay.
   */
  async makeRequest(
    method: string,
    endpoint: string,
    data: Record<string, unknown> = {},
    files: Record<string, { buffer: Buffer; filename?: string }> = {},
    query: Record<string, QueryValue> = {},
    options: RequestOptions = {},
  ): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
    endpoint = withQuery(endpoint, query);
    const url = `${this.config.baseUrl}/${this.config.version}/${endpoint.replace(/^\//, '')}`;
    const hasFiles = Object.keys(files).length > 0;
    const idempotencyKey = options.idempotencyKey;
    if (idempotencyKey !== undefined) {
      assertValidIdempotencyKey(idempotencyKey);
    }

    const baseHeaders: Record<string, string> = {
      ...this.identificationHeaders,
      Accept: 'application/json',
      'X-API-Key': this.config.apiKey,
    };
    if (idempotencyKey !== undefined) {
      baseHeaders['Idempotency-Key'] = idempotencyKey;
    }

    let prepare: () => AttemptRequest;

    if (hasFiles) {
      // Sign exactly the strings that go on the wire: the server signs the fields it receives.
      const fields = toMultipartFields(data);
      const fileBuffers = Object.values(files).map((f) => f.buffer);

      const form = new FormData();
      for (const [key, val] of Object.entries(fields)) {
        form.append(key, val);
      }
      for (const [fieldName, { buffer, filename }] of Object.entries(files)) {
        const name = filename ?? fieldName;
        form.append(fieldName, new Blob([new Uint8Array(buffer)]), name);
      }

      prepare = () => {
        const timestamp = this.timestamp();
        return {
          timestamp,
          headers: {
            ...baseHeaders,
            'X-Timestamp': timestamp,
            'X-HMAC-Signature': generateHmacSignatureForFiles(
              this.config.secretKey,
              method,
              this.config.version,
              endpoint,
              fields,
              fileBuffers,
              timestamp,
            ),
          },
          body: form,
        };
      };
    } else {
      const rawBody = serializeJsonBody(data);

      prepare = () => {
        const timestamp = this.timestamp();
        const headers: Record<string, string> = {
          ...baseHeaders,
          'X-Timestamp': timestamp,
          'X-HMAC-Signature': generateHmacSignature(
            this.config.secretKey,
            method,
            this.config.version,
            endpoint,
            rawBody,
            timestamp,
          ),
        };
        if (rawBody !== '') {
          headers['Content-Type'] = 'application/json';
        }
        return { timestamp, headers, body: rawBody === '' ? undefined : rawBody };
      };
    }

    return this.sendWithRetry(method, url, prepare, idempotencyKey !== undefined);
  }

  /**
   * Fetch a binary endpoint without decoding the body.
   *
   * sendWithRetry() reads every response through res.text(), which corrupts
   * bytes, and it retries 429. Neither is right for a download: text decoding
   * destroys the image, and retrying a rate limit in-process spends the same
   * per-minute budget that just refused us — a caller running downloads from a
   * queue should let its own backoff own that wait. So this path decodes
   * nothing and never retries an HTTP status.
   *
   * Returns the web ReadableStream of the body, so a large file never has to
   * sit in memory.
   */
  async makeStreamedRequest(
    method: string,
    endpoint: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.config.baseUrl}/${this.config.version}/${endpoint.replace(/^\//, '')}`;
    const timestamp = this.timestamp();
    const signature = generateHmacSignature(
      this.config.secretKey,
      method,
      this.config.version,
      endpoint,
      '',
      timestamp,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...this.identificationHeaders,
          'X-API-Key': this.config.apiKey,
          'X-Timestamp': timestamp,
          'X-HMAC-Signature': signature,
          Accept: DOWNLOAD_ACCEPT,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        this.throwForParsedErrorResponse(res.status, await res.text());
      }

      if (!res.body) {
        throw new ProofAgeError('Response carried no body', res.status);
      }

      return res.body;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send a request, retrying only where a repeat cannot duplicate work on the server.
   *
   * - GET/HEAD: retried on 408, 429, 5xx, timeouts and network errors.
   * - A POST (or other method) that carries an Idempotency-Key is safe to repeat, so it is retried
   *   like a GET, and also on `409 IDEMPOTENCY_KEY_IN_PROGRESS` (the first attempt is still
   *   running), honouring `Retry-After`. Every attempt sends the same key.
   * - POST (and any other non-idempotent method) without a key: retried only on 429 — the rate limiter
   *   refuses before anything runs — and on network errors raised before the request was sent
   *   (DNS failure, connection refused). A 5xx, a timeout or a dropped connection may mean
   *   the server already acted (created a verification, stored an upload), so those throw.
   *
   * A non-GET request answered `401 REPLAYED_REQUEST` was never processed (two identical requests
   * signed in the same second collide): it waits for the next whole second of the clock, is signed
   * again and sent once more, whatever `retryAttempts` says; that resend is not counted in it. A
   * second `REPLAYED_REQUEST` throws.
   *
   * Each attempt calls `prepare()` for its headers and body, so `X-Timestamp` and the signature
   * are fresh every time.
   *
   * A 429 waits for its `Retry-After` when the API sends one (more than 60 s is thrown at once),
   * else the linear backoff; `REAUTH_RATE_LIMITED` is thrown at once, as waiting does not clear it.
   */
  private async sendWithRetry(
    method: string,
    url: string,
    prepare: () => AttemptRequest,
    hasIdempotencyKey: boolean,
  ): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
    const max = Math.max(1, this.config.retryAttempts);
    const idempotent = hasIdempotencyKey || IDEMPOTENT_METHODS.has(method.toUpperCase());
    let lastError: unknown;
    let replayResent = false;
    let skewResent = false;
    let previousSecond: number | undefined;

    for (let attempt = 0; attempt < max; attempt++) {
      const isLastAttempt = attempt >= max - 1;
      const backoff = this.config.retryDelay * (attempt + 1);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeout);

      if (previousSecond !== undefined && !IDEMPOTENT_METHODS.has(method.toUpperCase())) {
        // Every re-attempt of a non-GET request, whatever the reason, signs in a new second.
        await this.untilNewSecond(previousSecond);
      }
      const { headers, body, timestamp } = prepare();
      previousSecond = Number(timestamp);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        lastError = e;
        const retryable = idempotent || failedBeforeSending(e);
        if (retryable && !isLastAttempt) {
          await this.delay(backoff);
          continue;
        }
        throw e;
      }
      clearTimeout(timer);

      const rawText = await res.text();

      if (res.ok) {
        const status = res.status;
        const contentType = res.headers.get('content-type') ?? 'unknown';
        return {
          status,
          text: async () => rawText,
          json: async () => {
            if (rawText.trim() === '') {
              return null;
            }
            try {
              return JSON.parse(rawText) as unknown;
            } catch (cause) {
              throw new ProofAgeError(
                `Expected a JSON response from ${url} but got HTTP ${status} with a non-JSON body ` +
                  `(Content-Type: ${contentType}). Check that baseUrl is the API origin, ` +
                  `e.g. https://api.proofage.net`,
                status,
                { responseBody: rawText, cause },
              );
            }
          },
        };
      }

      const retryableStatus = idempotent
        ? res.status === 408 || res.status === 429 || (res.status >= 500 && res.status < 600)
        : res.status === 429;

      // Two different calls with byte-identical requests signed in the same second share a
      // signature, and the API refuses the second as a replay before processing it. So a
      // non-GET request refused this way is signed again in the next second and sent once more.
      // This resend does not count against retryAttempts.
      if (
        res.status === 401 &&
        !IDEMPOTENT_METHODS.has(method.toUpperCase()) &&
        !replayResent &&
        parseErrorBody(rawText).errorData?.code === REPLAYED_REQUEST
      ) {
        replayResent = true;
        attempt--;
        continue;
      }

      // The host's clock is off by more than the API's window. Learn the offset from the answer's
      // `Date` header and send the request once more, signed with the corrected time. The
      // rejected timestamp was never accepted, so this resend cannot collide with it.
      if (res.status === 401 && !skewResent && parseErrorBody(rawText).errorData?.code === TIMESTAMP_OUT_OF_RANGE) {
        const serverTime = Date.parse(res.headers.get('date') ?? '');
        if (Number.isFinite(serverTime)) {
          skewResent = true;
          this.clockOffsetMs = serverTime - this.clock();
          attempt--;
          continue;
        }
      }

      const inProgress =
        hasIdempotencyKey && res.status === 409 && parseErrorBody(rawText).errorData?.code === IDEMPOTENCY_IN_PROGRESS;

      const retryAfter =
        res.status === 429 || inProgress ? retryAfterMs(res.headers.get('retry-after')) : undefined;

      if (inProgress && !isLastAttempt && (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_MS)) {
        await this.delay(retryAfter ?? backoff);
        continue;
      }

      if (retryableStatus && !isLastAttempt && (res.status !== 429 || retryable429(retryAfter, rawText))) {
        const wait = retryAfter ?? backoff;
        await this.delay(wait);
        continue;
      }

      this.throwForParsedErrorResponse(res.status, rawText);
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private throwForParsedErrorResponse(status: number, text: string): never {
    const { message: parsedMessage, errorData, errors } = parseErrorBody(text);
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    const message = parsedMessage ?? (snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`);
    const options = { responseBody: text, errorData };

    if (status === 401) {
      throw new AuthenticationError(message, status, options);
    }
    if (status === 422) {
      throw new ValidationError(message, status, errors, options);
    }

    throw new ProofAgeError(message, status, options);
  }
}
