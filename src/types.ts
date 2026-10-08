/**
 * ProofAge API client configuration.
 * All fields are optional when using `ProofAgeClient.fromEnv()` — they resolve from process.env.
 */
export interface ProofAgeConfig {
  apiKey?: string;
  secretKey?: string;
  /**
   * The API origin, without the version path: `https://api.proofage.xyz` (the default).
   * The client appends `/{version}` itself; a trailing `/v1` is stripped so a URL copied
   * from the OpenAPI `servers` entry still works.
   */
  baseUrl?: string;
  version?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  /**
   * For packages that wrap this client (e.g. a Shopify app): `<name>/<version>` tokens,
   * outermost wrapper first, sent ahead of this SDK's own token in `X-ProofAge-Sdk` —
   * `['shopify-app/1.4.0']` sends `X-ProofAge-Sdk: shopify-app/1.4.0 node/<version>`.
   * The SDK's own `node/<version>` token is always sent last and cannot be removed; a
   * token named `node` here is ignored. An invalid token throws at construction.
   */
  sdkTokens?: readonly string[];
  /**
   * Overrides the default `User-Agent: ProofAge-Node/<version> (Node <runtime>)`.
   * `X-ProofAge-Sdk` is sent either way.
   */
  userAgent?: string;
}

/**
 * POST /v1/verifications body (snake_case matches API).
 */
export interface CreateVerificationPayload {
  callback_url?: string;
  external_id?: string;
  external_metadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  fingerprint?: string;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  page_url?: string;
}

/** @deprecated Browser details the ProofAge widget sends with consent; not part of the public API. */
export interface ConsentDevice {
  platform?: string | null;
  screen?: string | null;
  language?: string | null;
  timezone?: string | null;
  hardware_concurrency?: number | null;
  device_memory?: number | null;
}

/** @deprecated Sent by the ProofAge widget; not part of the public API. */
export type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * POST /v1/verifications/{id}/consent body. `consent_version_id` and `text_sha256` come from
 * `client.workspace().getConsent()` (`id` and `text_sha256`).
 */
export interface AcceptConsentPayload {
  consent_version_id: number;
  /** 64 hex characters. */
  text_sha256: string;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  device?: ConsentDevice | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  in_app_browser?: string | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  camera_permission?: CameraPermissionState | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  camera_policy_allowed?: boolean | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  in_iframe?: boolean | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  referrer?: string | null;
}

/** `liveness_selfie` is deprecated: the ProofAge widget sends it, integrations upload `selfie`. */
export type MediaUploadType = 'selfie' | 'liveness_selfie' | 'document';

export type DocumentSide = 'front' | 'back';

export type DocumentType = 'id' | 'driver_license' | 'passport' | 'residence_permit';

interface UploadMediaCommon {
  /** The image bytes (10 MB max; documents need at least 200px on each edge). */
  file: Buffer | Uint8Array;
  /** Filename sent with the multipart part. Defaults to `upload.bin`. */
  filename?: string;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  fingerprint?: string | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  head_turn_step?: number | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  capture_resolution?: string | Record<string, unknown> | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  device_info?: string | Record<string, unknown> | null;
  /** @deprecated Sent by the ProofAge widget, not part of the public API. Still accepted; will be removed in a future minor release. */
  liveness_telemetry?: string | unknown[] | null;
}

/**
 * POST /v1/verifications/{id}/media (multipart). A document upload needs `side` and `document`.
 */
export type UploadMediaPayload =
  | (UploadMediaCommon & { type: 'selfie' | 'liveness_selfie'; side?: never; document?: never })
  | (UploadMediaCommon & { type: 'document'; side: DocumentSide; document: DocumentType });

/**
 * Why a face is being blocked. Optional over the API and mandatory in the
 * ProofAge consoles, so a block sent without one cannot be told apart from an
 * automated block when the blocklist is reported on — send it whenever a person
 * made the decision.
 *
 * - `presentation_attack` — the selfie or document was photographed from a screen, a print, or a mask
 * - `fraudulent_document` — the document is forged, edited, or not a real identity document
 * - `scam_or_abuse` — the identity may be genuine; the person is blocked for what they did on your platform
 * - `underage` — the person is below the age the workspace verifies for
 * - `other` — anything the codes above do not cover; explain it in `reason`
 */
export const BLOCK_FACE_REASON_CODES = [
  'presentation_attack',
  'fraudulent_document',
  'scam_or_abuse',
  'underage',
  'other',
] as const;

export type BlockFaceReasonCode = (typeof BLOCK_FACE_REASON_CODES)[number];

/**
 * POST /v1/verifications/{id}/blocked-face body.
 */
export interface BlockFacePayload {
  reason_code?: BlockFaceReasonCode;
  /** Free-text detail, truncated to 1000 characters rather than rejected. */
  reason?: string;
}

/**
 * Statuses `GET /v1/verifications` filters on. `documents_required` is not one: a verification
 * waiting for a document is stored as `started` (and listed as `documents_required`).
 */
export const LIST_VERIFICATIONS_STATUSES = [
  'created',
  'started',
  'submitted',
  'resubmission_requested',
  'approved',
  'declined',
  'abandoned',
  'expired',
  'review',
] as const;

export type ListVerificationsStatus = (typeof LIST_VERIFICATIONS_STATUSES)[number];

/**
 * GET /v1/verifications query. `status` takes one status, an array, or a comma-separated
 * string; an array is sent comma-separated. Send the same filters with `cursor`.
 */
export interface ListVerificationsParams {
  status?: ListVerificationsStatus | readonly ListVerificationsStatus[] | (string & {});
  /** Exact, case-sensitive match (<= 255 characters). */
  external_id?: string;
  /** 1 to 100; the API defaults to 20. */
  limit?: number;
  /** The `next_cursor` of the previous page. */
  cursor?: string;
}

/** The outcomes `setTestOutcome()` can set. */
export const TEST_VERIFICATION_OUTCOMES = ['approved', 'declined', 'review', 'resubmission_requested'] as const;

export type TestVerificationOutcome = (typeof TEST_VERIFICATION_OUTCOMES)[number];

/** POST /v1/verifications/{id}/test-outcome body. Test workspaces only. */
export interface SetTestOutcomePayload {
  status: TestVerificationOutcome;
  /**
   * A note kept with a `resubmission_requested` outcome in the verification's history
   * (<= 1000 characters). It is not the decision `reason` code.
   */
  reason?: string | null;
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
  /** The consent version number; informational (accept with `id` and `text_sha256`). */
  version: number;
  text_sha256: string;
  url: string;
}

/**
 * Known verification statuses. `documents_required` is surfaced from the latest attempt's
 * state rather than being a verification status. The type stays open (`string & {}`) so a
 * status added upstream does not break compilation — treat unknown values gracefully.
 */
export type VerificationStatus =
  | 'created'
  | 'started'
  | 'submitted'
  | 'resubmission_requested'
  | 'approved'
  | 'declined'
  | 'abandoned'
  | 'expired'
  | 'review'
  | 'documents_required'
  | (string & {});

/** Duplicate-face check on the verification's latest attempt. */
export interface DuplicateCheck {
  checked: boolean;
  duplicate_count: number;
  duplicates: Array<{
    verification_id: string;
    external_id: string | null;
    similarity_score: number;
    verified_at: string | null;
  }>;
}

/** Set once the verification's personal data has been erased; null otherwise. */
export interface Erasure {
  erased_at: string;
  /** Currently always `personal_data`. */
  scope: string;
  /** Erasure reason code, e.g. `data_subject_request`, `retention_policy`; null if unrecorded. */
  reason: string | null;
  /** Who asked: `customer`, `proofage` or `retention`; null if unrecorded. */
  requested_via: string | null;
}

/** GET /v1/verifications/{id} */
export interface Verification {
  id: string;
  external_id: string | null;
  external_metadata: Record<string, unknown> | null;
  redirect_url: string | null;
  status: VerificationStatus;
  reason: string | null;
  duplicate_check: DuplicateCheck;
  erasure: Erasure | null;
  consent_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /v1/verifications: a page of verifications, newest first. */
export interface VerificationList {
  /** Each in the shape `GET /v1/verifications/{id}` returns. */
  data: Verification[];
  /** Pass as `cursor` for the next page; null on the last page. */
  next_cursor: string | null;
}

/** POST /v1/verifications (201) also returns the hosted session `url`. */
export interface CreatedVerification extends Verification {
  url: string;
}

/** POST /v1/verifications/{id}/consent */
export interface AcceptConsentResult {
  consent_version_id: number;
  consent_accepted_at: string;
}

/**
 * The document type a result reports. `other` is a readable document that is not an identity card, passport, driving licence or residence permit, such as a health insurance card. Open, so a
 * value added upstream does not break compilation: handle unknown values.
 */
export type DocumentResultType = DocumentType | 'other' | (string & {});

/**
 * The sex a document states. `X` means the document states that the sex is unspecified. Open, so a
 * value added upstream does not break compilation.
 */
export type DocumentGender = 'F' | 'M' | 'X' | (string & {});

/**
 * GET /v1/verifications/{id}/document. Identity (KYC) workspaces receive all eleven `fields`;
 * age workspaces receive only the four base ones, so the seven KYC-only keys are optional
 * (absent there, not null). Dates are `YYYY-MM-DD`; countries are ISO 3166-1 alpha-2 (`XK`
 * for Kosovo). Keep every new key optional: an older API body must still parse.
 */
export interface VerificationDocument {
  document: {
    type?: DocumentResultType | null;
    issuing_country?: string | null;
    /** State or province of issuance as a bare code (`FL` with `US`), or null; filled for US driving licences and ID cards. */
    issuing_subdivision?: string | null;
    fields: {
      first_name: string | null;
      middle_name?: string | null;
      last_name: string | null;
      date_of_birth: string | null;
      gender?: DocumentGender | null;
      nationality?: string | null;
      place_of_birth?: string | null;
      /** Printed text as read: not parsed, may contain line breaks. KYC workspaces only. */
      address?: string | null;
      document_number: string | null;
      issue_date?: string | null;
      expiry_date?: string | null;
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

/** Who made a manual moderation decision (present on webhooks after a console approve/decline). */
export interface ManualModeration {
  action: 'approve' | 'decline';
  reason: string;
  /** `tenant_admin` or `landlord_admin`. */
  source: string;
  performed_by: {
    id: number;
    name: string | null;
    email: string | null;
    role: string | null;
  };
  /** Only on `approve`: the status the verification had before it was approved. */
  source_status?: string;
  /** Only on `approve`: the reason code the verification had before it was approved. */
  source_reason?: string | null;
}

/** Webhook event kinds. Open, so a value added upstream does not break compilation. */
export type WebhookEvent = 'status.updated' | 'data.updated' | (string & {});

/**
 * Webhook JSON body (ProofAge outbound webhook).
 */
export interface WebhookPayload {
  verification_id: string;
  /**
   * What happened: `status.updated` (the verification moved to `status`) or `data.updated` (someone
   * corrected the document fields the reader got wrong; `status` is the current one, unchanged).
   * Optional: a payload without it, such as a retry of a delivery created before the field existed,
   * means `status.updated`. The type stays open so an event added later does not break compilation.
   * Read it before `status`.
   */
  event?: WebhookEvent;
  status: VerificationStatus;
  external_id: string | null;
  external_metadata: Record<string, unknown> | null;
  /** Always present; a reason code only on `resubmission_requested` / `declined`, otherwise null. */
  reason: string | null;
  timestamp: string;
  /**
   * The same object `GET /v1/verifications/{id}/document` returns (without `media`), on every decision
   * webhook. Optional on the type: a body sent before this was added, and the body of a retry after
   * the person's data was erased, parse too. After erasure a resend keeps `type` and `issuing_country`
   * and nulls every field.
   */
  document?: VerificationDocument['document'];
  /** Only on `data.updated`: the names of the `document.fields` the correction changed (names only, no values). */
  changed_fields?: string[];
  /** Only when a duplicate face was found. */
  duplicate_detected?: true;
  /** Only when a duplicate face was found. */
  duplicate_count?: number;
  /** Only when a duplicate face was found: the first duplicate. */
  duplicate_of?: {
    verification_id: string;
    external_id: string | null;
  };
  /** Technical signals (ip_address, ip_country_code, ip_timezone, device_timezone, ...), when any were collected. */
  fingerprint_signals?: Record<string, unknown>;
  manual_moderation?: ManualModeration;
}

/**
 * Error bodies the API answers with. The shape depends on where the request was refused:
 * - `{ error: { code, message } }` — most API errors (auth, rate limit, submit, media download);
 * - `{ code, message, ...extra }` — flat: `402 PAYMENT_METHOD_REQUIRED` and media quality
 *   rejections on upload (e.g. `422 FACE_NOT_FOUND`);
 * - `{ message, errors }` — request validation (`422`);
 * - `{ message }` — `403` / `404`.
 */
export interface ApiErrorBody {
  error?: {
    message?: string;
    code?: string;
    [key: string]: unknown;
  };
  code?: string;
  message?: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

/** The normalized error detail carried on `ProofAgeError.errorData`, whatever shape the API used. */
export interface ApiErrorData {
  message?: string;
  code?: string;
  [key: string]: unknown;
}
