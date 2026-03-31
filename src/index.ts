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
export { generateWebhookSignature, verifyWebhookSignature } from './webhook.js';
export type { VerifyWebhookSignatureInput } from './webhook.js';
export { VerificationResource } from './resources/verifications.js';
export { WorkspaceResource } from './resources/workspace.js';
export type {
  AcceptConsentPayload,
  ApiErrorBody,
  CreateVerificationPayload,
  ProofAgeConfig,
  UploadMediaPayload,
  WebhookPayload,
} from './types.js';
