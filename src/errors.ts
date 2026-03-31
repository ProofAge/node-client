import type { ApiErrorBody } from './types.js';

export class ProofAgeError extends Error {
  readonly statusCode: number;

  readonly responseBody?: string;

  readonly errorData: ApiErrorBody['error'];

  constructor(
    message: string,
    statusCode: number,
    options?: {
      responseBody?: string;
      errorData?: ApiErrorBody['error'];
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ProofAgeError';
    this.statusCode = statusCode;
    this.responseBody = options?.responseBody;
    this.errorData = options?.errorData;
  }

  getErrorCode(): string | undefined {
    return this.errorData?.code as string | undefined;
  }
}

export class AuthenticationError extends ProofAgeError {
  constructor(
    message: string,
    statusCode: number,
    options?: { responseBody?: string; errorData?: ApiErrorBody['error']; cause?: unknown },
  ) {
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
    options?: { responseBody?: string; errorData?: ApiErrorBody['error']; cause?: unknown },
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
