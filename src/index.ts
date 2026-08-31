export { ProofAgeClient } from './client.js';
export {
  AuthenticationError,
  ProofAgeError,
  ValidationError,
  WebhookVerificationError,
} from './errors.js';
export type { WebhookVerificationErrorCode } from './errors.js';
export {
  buildApiPath,
  canonicalizeArrayForQuery,
  generateHmacSignature,
  generateHmacSignatureForFiles,
  phpHttpBuildQueryRfc3986,
  serializeJsonBody,
  sha256Hex,
} from './hmac.js';
export { generateWebhookSignature, handleWebhook, verifyWebhookSignature, webhookHandler } from './webhook.js';
export type { HandleWebhookOptions, HandleWebhookResult, VerifyWebhookSignatureInput } from './webhook.js';
export { BLOCK_FACE_REASON_CODES } from './types.js';
export { VerificationResource } from './resources/verifications.js';
export { WorkspaceResource } from './resources/workspace.js';
export type {
  AcceptConsentPayload,
  AcceptConsentResult,
  AgeEstimation,
  ApiErrorBody,
  BlockFacePayload,
  BlockFaceReasonCode,
  ConsentInfo,
  CreatedVerification,
  CreateVerificationPayload,
  MessageResult,
  ProofAgeConfig,
  UploadMediaPayload,
  Verification,
  VerificationDocument,
  WebhookPayload,
  WorkspaceInfo,
} from './types.js';
