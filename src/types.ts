/**
 * ProofAge API client configuration.
 * All fields are optional when using `ProofAgeClient.fromEnv()` — they resolve from process.env.
 */
export interface ProofAgeConfig {
  apiKey?: string;
  secretKey?: string;
  baseUrl?: string;
  version?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * POST /v1/verifications body (snake_case matches API).
 */
export interface CreateVerificationPayload {
  fingerprint?: string;
  callback_url?: string;
  external_id?: string;
  external_metadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AcceptConsentPayload {
  consent_version_id: string;
  text_sha256: string;
}

export interface UploadMediaPayload {
  type: string;
  file: Buffer | Uint8Array;
  filename?: string;
}

/**
 * Webhook JSON body (ProofAge outbound webhook).
 */
export interface WebhookPayload {
  verification_id: string;
  status: string;
  external_id?: string | null;
  external_metadata?: Record<string, unknown> | null;
  reason?: string | null;
  timestamp: string;
  duplicate_detected?: boolean;
  duplicate_of?: {
    verification_id: string;
    external_id?: string | null;
  };
}

export interface ApiErrorBody {
  error?: {
    message?: string;
    code?: string;
    [key: string]: unknown;
  };
  errors?: Record<string, string[]>;
}
