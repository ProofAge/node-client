import { AuthenticationError, ProofAgeError, ValidationError } from './errors.js';
import {
  generateHmacSignature,
  generateHmacSignatureForFiles,
  serializeJsonBody,
  toMultipartFields,
} from './hmac.js';
import { VerificationResource } from './resources/verifications.js';
import { WorkspaceResource } from './resources/workspace.js';
import type { ApiErrorData, ProofAgeConfig } from './types.js';

const DEFAULT_BASE_URL = 'https://api.proofage.xyz';
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

/**
 * Normalize the base URL to the API origin (plus any proxy path prefix), without the version.
 * A trailing `/{version}` — e.g. `https://api.proofage.xyz/v1` copied from the OpenAPI
 * `servers` entry — is stripped, because the client appends the version itself.
 */
function normalizeBaseUrl(raw: string, version: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProofAgeError(
      `Invalid baseUrl "${raw}": expected the API origin, e.g. https://api.proofage.xyz (without /${version})`,
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
  }

  workspace(): WorkspaceResource {
    return new WorkspaceResource(this);
  }

  verifications(verificationId?: string): VerificationResource {
    return new VerificationResource(this, verificationId);
  }

  getConfig(): Readonly<typeof this.config> {
    return this.config;
  }

  async makeRequest(
    method: string,
    endpoint: string,
    data: Record<string, unknown> = {},
    files: Record<string, { buffer: Buffer; filename?: string }> = {},
  ): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
    const url = `${this.config.baseUrl}/${this.config.version}/${endpoint.replace(/^\//, '')}`;
    const hasFiles = Object.keys(files).length > 0;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-API-Key': this.config.apiKey,
    };

    let body: BodyInit | undefined;

    if (hasFiles) {
      // Sign exactly the strings that go on the wire: the server signs the fields it receives.
      const fields = toMultipartFields(data);
      const fileBuffers = Object.values(files).map((f) => f.buffer);
      const signature = generateHmacSignatureForFiles(
        this.config.secretKey,
        method,
        this.config.version,
        endpoint,
        fields,
        fileBuffers,
      );
      headers['X-HMAC-Signature'] = signature;

      const form = new FormData();
      for (const [key, val] of Object.entries(fields)) {
        form.append(key, val);
      }
      for (const [fieldName, { buffer, filename }] of Object.entries(files)) {
        const name = filename ?? fieldName;
        form.append(fieldName, new Blob([new Uint8Array(buffer)]), name);
      }
      body = form;
    } else {
      const rawBody = serializeJsonBody(data);
      const signature = generateHmacSignature(
        this.config.secretKey,
        method,
        this.config.version,
        endpoint,
        rawBody,
      );
      headers['X-HMAC-Signature'] = signature;

      if (rawBody !== '') {
        headers['Content-Type'] = 'application/json';
        body = rawBody;
      }
    }

    return this.sendWithRetry(method, url, headers, body);
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
    const signature = generateHmacSignature(
      this.config.secretKey,
      method,
      this.config.version,
      endpoint,
      '',
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'X-API-Key': this.config.apiKey,
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
   * - POST (and any other non-idempotent method): retried only on 429 — the rate limiter
   *   refuses before anything runs — and on network errors raised before the request was sent
   *   (DNS failure, connection refused). A 5xx, a timeout or a dropped connection may mean
   *   the server already acted (created a verification, stored an upload), so those throw.
   *
   * A 429 waits for its `Retry-After` when the API sends one, else the linear backoff.
   */
  private async sendWithRetry(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: BodyInit | undefined,
  ): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
    const max = Math.max(1, this.config.retryAttempts);
    const idempotent = IDEMPOTENT_METHODS.has(method.toUpperCase());
    let lastError: unknown;

    for (let attempt = 0; attempt < max; attempt++) {
      const isLastAttempt = attempt >= max - 1;
      const backoff = this.config.retryDelay * (attempt + 1);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeout);

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
                  `e.g. https://api.proofage.xyz`,
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

      if (retryableStatus && !isLastAttempt) {
        const wait = res.status === 429 ? (retryAfterMs(res.headers.get('retry-after')) ?? backoff) : backoff;
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
