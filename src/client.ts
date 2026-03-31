import { AuthenticationError, ProofAgeError, ValidationError } from './errors.js';
import {
  generateHmacSignature,
  generateHmacSignatureForFiles,
  serializeJsonBody,
} from './hmac.js';
import { VerificationResource } from './resources/verifications.js';
import { WorkspaceResource } from './resources/workspace.js';
import type { ProofAgeConfig } from './types.js';

const DEFAULT_BASE_URL = 'https://api.proofage.xyz';
const DEFAULT_VERSION = 'v1';

export class ProofAgeClient {
  private readonly config: Required<
    Pick<ProofAgeConfig, 'apiKey' | 'secretKey' | 'baseUrl' | 'version' | 'timeout' | 'retryAttempts' | 'retryDelay'>
  >;

  constructor(config: ProofAgeConfig) {
    if (!config.apiKey) {
      throw new ProofAgeError('API key is required', 0);
    }
    if (!config.secretKey) {
      throw new ProofAgeError('Secret key is required', 0);
    }

    this.config = {
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
      version: config.version ?? DEFAULT_VERSION,
      timeout: config.timeout ?? 30_000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
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
      const fileBuffers = Object.values(files).map((f) => f.buffer);
      const signature = generateHmacSignatureForFiles(
        this.config.secretKey,
        method,
        this.config.version,
        endpoint,
        data,
        fileBuffers,
      );
      headers['X-HMAC-Signature'] = signature;

      const form = new FormData();
      for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          form.append(key, String(val));
        } else if (val !== null && val !== undefined) {
          form.append(key, JSON.stringify(val));
        }
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

  private async sendWithRetry(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: BodyInit | undefined,
  ): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
    const max = this.config.retryAttempts;
    let lastError: unknown;

    for (let attempt = 0; attempt < max; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const res = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const rawText = await res.text();
        const wrapped = {
          status: res.status,
          text: async () => rawText,
          json: async () => {
            if (!rawText) {
              return null;
            }
            try {
              return JSON.parse(rawText) as unknown;
            } catch {
              return null;
            }
          },
        };

        if (res.ok) {
          return wrapped;
        }

        const shouldRetry =
          res.status === 408 ||
          res.status === 429 ||
          (res.status >= 500 && res.status < 600);

        if (shouldRetry && attempt < max - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1));
          continue;
        }

        this.throwForParsedErrorResponse(res.status, rawText);
      } catch (e) {
        clearTimeout(timer);
        lastError = e;
        if (e instanceof ProofAgeError || e instanceof AuthenticationError || e instanceof ValidationError) {
          throw e;
        }
        if (attempt < max - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1));
          continue;
        }
        throw e;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private throwForParsedErrorResponse(status: number, text: string): never {
    let parsed: { error?: { message?: string; code?: string }; errors?: Record<string, string[]> } = {};
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {};
    } catch {
      /* body is not JSON */
    }

    const message = parsed.error?.message ?? (text || `HTTP ${status}`);

    if (status === 401) {
      throw new AuthenticationError(message, status, {
        responseBody: text,
        errorData: parsed.error,
      });
    }
    if (status === 422) {
      throw new ValidationError(
        message,
        status,
        parsed.errors ?? {},
        { responseBody: text, errorData: parsed.error },
      );
    }

    throw new ProofAgeError(message, status, {
      responseBody: text,
      errorData: parsed.error,
    });
  }
}
