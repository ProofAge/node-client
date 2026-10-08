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
  buildQueryString,
  canonicalizeArrayForQuery,
  generateHmacSignature,
  generateHmacSignatureForFiles,
  phpHttpBuildQueryRfc3986,
  rawUrlEncode,
  serializeJsonBody,
  sha256Hex,
  toMultipartFields,
  withQuery,
} from './hmac.js';
export type { QueryValue } from './hmac.js';
export { generateWebhookSignature, handleWebhook, verifyWebhookSignature, webhookHandler } from './webhook.js';
export type { HandleWebhookOptions, HandleWebhookResult, VerifyWebhookSignatureInput } from './webhook.js';
export {
  BLOCK_FACE_REASON_CODES,
  LIST_VERIFICATIONS_STATUSES,
  TEST_VERIFICATION_OUTCOMES,
  WEBHOOK_SUBSCRIPTION_STATUSES,
} from './types.js';
export { SDK_VERSION } from './version.js';
export { VerificationResource } from './resources/verifications.js';
export { WebhookSubscriptionResource } from './resources/webhook-subscriptions.js';
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
  CreateWebhookSubscriptionPayload,
  DocumentSide,
  DocumentGender,
  DocumentResultType,
  DocumentType,
  DuplicateCheck,
  Erasure,
  ListVerificationsParams,
  ListVerificationsStatus,
  ManualModeration,
  MediaUploadType,
  ProofAgeConfig,
  SetTestOutcomePayload,
  TestVerificationOutcome,
  UploadMediaPayload,
  Verification,
  VerificationDocument,
  VerificationList,
  VerificationStatus,
  WebhookEvent,
  WebhookPayload,
  WebhookSubscription,
  WebhookSubscriptionList,
  WebhookSubscriptionStatus,
  WorkspaceInfo,
} from './types.js';
