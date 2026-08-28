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
 * POST /v1/verifications/{id}/blocked-face body.
 */
export interface BlockFacePayload {
  reason?: string;
}

/* ----------------------------------------------------------------------------
 * Response shapes (snake_case, matching the API). These are the authoritative
 * response contract: the bundled openapi.json cannot describe most response
 * bodies (generator limitation), so these types — guarded by the drift test —
 * are what callers should rely on.
 * ------------------------------------------------------------------------- */

/** GET /v1/workspace */
export interface WorkspaceInfo {
  id: string;
  name: string;
  flow_type: string;
  mode: string;
  age_mode: string | null;
  age_threshold: number | null;
  verification_type: string;
  redirect_url: string | null;
  webhook_url: string | null;
  allow_expired_documents: boolean;
  allow_duplicate_accounts: boolean;
}

/** GET /v1/consent */
export interface ConsentInfo {
  id: number;
  version: string;
  text_sha256: string;
  url: string;
}

/** GET /v1/verifications/{id} */
export interface Verification {
  id: string;
  external_id: string | null;
  external_metadata: Record<string, unknown> | null;
  redirect_url: string | null;
  status: string;
  reason: string | null;
  consent_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /v1/verifications also returns the hosted session `url`. */
export interface CreatedVerification extends Verification {
  url: string;
}

/** POST /v1/verifications/{id}/consent */
export interface AcceptConsentResult {
  consent_version_id: number;
  consent_accepted_at: string;
}

/** POST /v1/verifications/{id}/media and POST /v1/verifications/{id}/submit */
export interface MessageResult {
  message: string;
}

/** GET /v1/verifications/{id}/document */
export interface VerificationDocument {
  document: {
    fields: {
      first_name: string | null;
      last_name: string | null;
      date_of_birth: string | null;
      document_number: string | null;
    };
  };
  media: Array<{
    id: string;
    type: string;
    /** Download endpoint for this media; null once purged or past retention. */
    url: string | null;
  }>;
  meta: {
    attempt_id: string | null;
  };
}

/** GET /v1/verifications/{id}/estimation (gender value: 0 = female, 1 = male) */
export interface AgeEstimation {
  verification_id: string;
  attempt_id: string | null;
  age_threshold: {
    minimum: number | null;
    passed: boolean | null;
    confidence: number | null;
  };
  gender: {
    value: 0 | 1 | null;
    confidence: number | null;
  } | null;
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
