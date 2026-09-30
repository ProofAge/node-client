export { ProofAgeClient } from './client.js';
export {
  AuthenticationError,
  ProofAgeError,
  ValidationError,
  WebhookVerificationError,
} from './errors.js';
export type { ProofAgeErrorOptions, WebhookVerificationErrorCode } from './errors.js';
export {
  buildApiPath,
  canonicalizeArrayForQuery,
  generateHmacSignature,
  generateHmacSignatureForFiles,
  phpHttpBuildQueryRfc3986,
  rawUrlEncode,
  serializeJsonBody,
  sha256Hex,
  toMultipartFields,
} from './hmac.js';
export { generateWebhookSignature, handleWebhook, verifyWebhookSignature, webhookHandler } from './webhook.js';
export type { HandleWebhookOptions, HandleWebhookResult, VerifyWebhookSignatureInput } from './webhook.js';
export { BLOCK_FACE_REASON_CODES } from './types.js';
export { SDK_VERSION } from './version.js';
export { VerificationResource } from './resources/verifications.js';
export { WorkspaceResource } from './resources/workspace.js';
export type {
  AcceptConsentPayload,
  AcceptConsentResult,
  AgeEstimation,
  ApiErrorBody,
  ApiErrorData,
  BlockFacePayload,
  BlockFaceReasonCode,
  CameraPermissionState,
  ConsentDevice,
  ConsentInfo,
  CreatedVerification,
  CreateVerificationPayload,
  DocumentSide,
  DocumentGender,
  DocumentResultType,
  DocumentType,
  DuplicateCheck,
  Erasure,
  ManualModeration,
  MediaUploadType,
  ProofAgeConfig,
  UploadMediaPayload,
  Verification,
  VerificationDocument,
  VerificationStatus,
  WebhookPayload,
  WorkspaceInfo,
} from './types.js';
