import type { ApiErrorData } from './types.js';

export interface ProofAgeErrorOptions {
  responseBody?: string;
  errorData?: ApiErrorData;
  cause?: unknown;
}

export class ProofAgeError extends Error {
  readonly statusCode: number;

  readonly responseBody?: string;

  /**
   * The error detail, normalized across the API's error shapes: `{ error: {...} }` is
   * unwrapped, a flat `{ code, message, ...extra }` body is kept whole (so e.g.
   * `free_verifications_remaining` on a 402 is here), and a Laravel `{ message }` body
   * yields `{ message }`. Undefined when the body carried no JSON object.
   */
  readonly errorData: ApiErrorData | undefined;

  constructor(message: string, statusCode: number, options?: ProofAgeErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = 'ProofAgeError';
    this.statusCode = statusCode;
    this.responseBody = options?.responseBody;
    this.errorData = options?.errorData;
  }

  /** The API's machine-readable error code (e.g. `INVALID_SIGNATURE`, `FACE_NOT_FOUND`), when it sent one. */
  get code(): string | undefined {
    const code = this.errorData?.code;
    return typeof code === 'string' ? code : undefined;
  }

  getErrorCode(): string | undefined {
    return this.code;
  }
}

export class AuthenticationError extends ProofAgeError {
  constructor(message: string, statusCode: number, options?: ProofAgeErrorOptions) {
    super(message, statusCode, options);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends ProofAgeError {
  readonly validationErrors: Record<string, string[]>;

  constructor(
    message: string,
    statusCode: number,
    validationErrors: Record<string, string[]>,
    options?: ProofAgeErrorOptions,
  ) {
    super(message, statusCode, options);
    this.name = 'ValidationError';
    this.validationErrors = validationErrors;
  }

  getErrors(): Record<string, string[]> {
    return this.validationErrors;
  }
}

export type WebhookVerificationErrorCode =
  | 'MISSING_SIGNATURE'
  | 'MISSING_TIMESTAMP'
  | 'MISSING_AUTH_CLIENT'
  | 'CONFIGURATION_ERROR'
  | 'INVALID_AUTH_CLIENT'
  | 'TIMESTAMP_TOO_OLD'
  | 'INVALID_SIGNATURE';

export class WebhookVerificationError extends Error {
  readonly code: WebhookVerificationErrorCode;

  readonly httpStatus: number;

  constructor(code: WebhookVerificationErrorCode, message: string, httpStatus = 401) {
    super(message);
    this.name = 'WebhookVerificationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
