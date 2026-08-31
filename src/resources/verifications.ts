import type { ProofAgeClient } from '../client.js';
import type {
  AcceptConsentPayload,
  AcceptConsentResult,
  AgeEstimation,
  BlockFacePayload,
  CreatedVerification,
  CreateVerificationPayload,
  MessageResult,
  UploadMediaPayload,
  Verification,
  VerificationDocument,
} from '../types.js';

export class VerificationResource {
  constructor(
    private readonly client: ProofAgeClient,
    private readonly verificationId?: string,
  ) {}

  async create(data: CreateVerificationPayload): Promise<CreatedVerification | null> {
    const res = await this.client.makeRequest('POST', 'verifications', data as Record<string, unknown>);
    return (await res.json()) as CreatedVerification | null;
  }

  async find(id: string): Promise<Verification | null> {
    const res = await this.client.makeRequest('GET', `verifications/${id}`);
    return (await res.json()) as Verification | null;
  }

  async get(): Promise<Verification | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    return this.find(this.verificationId);
  }

  async acceptConsent(data: AcceptConsentPayload): Promise<AcceptConsentResult | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const res = await this.client.makeRequest(
      'POST',
      `verifications/${this.verificationId}/consent`,
      data as unknown as Record<string, unknown>,
    );
    return (await res.json()) as AcceptConsentResult | null;
  }

  async uploadMedia(data: UploadMediaPayload): Promise<MessageResult | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const { file, filename = 'upload.bin', type } = data;
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
    const res = await this.client.makeRequest(
      'POST',
      `verifications/${this.verificationId}/media`,
      { type },
      { file: { buffer, filename } },
    );
    return (await res.json()) as MessageResult | null;
  }

  async submit(): Promise<MessageResult | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const res = await this.client.makeRequest('POST', `verifications/${this.verificationId}/submit`, {});
    return (await res.json()) as MessageResult | null;
  }

  async document(): Promise<VerificationDocument | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const res = await this.client.makeRequest('GET', `verifications/${this.verificationId}/document`);
    return (await res.json()) as VerificationDocument | null;
  }

  /**
   * Download one media file belonging to the verification.
   *
   * Streams the bytes from the ProofAge API under the same API key and HMAC
   * signature as every other call. The media ID is `media[].id` from
   * document(); check that entry's `url` is not null first, because null means
   * the media has been purged or is past its retention window.
   *
   * Media that does not belong to this verification, or is no longer
   * available, answers 404 and throws.
   */
  async downloadMedia(mediaId: string): Promise<ReadableStream<Uint8Array>> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    return this.client.makeStreamedRequest(
      'GET',
      `verifications/${this.verificationId}/media/${mediaId}`,
    );
  }

  /**
   * Download one media file straight to disk, without holding it in memory.
   *
   * Returns the path written to.
   */
  async downloadMediaTo(mediaId: string, path: string): Promise<string> {
    const body = await this.downloadMedia(mediaId);
    const { createWriteStream } = await import('node:fs');
    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');

    await pipeline(Readable.fromWeb(body as never), createWriteStream(path));

    return path;
  }

  async estimation(): Promise<AgeEstimation | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const res = await this.client.makeRequest('GET', `verifications/${this.verificationId}/estimation`);
    return (await res.json()) as AgeEstimation | null;
  }

  /**
   * Block the verification face for future AML checks. The API responds 204 No Content.
   *
   * Pass `reason_code` whenever a person made the decision — it is what blocklist
   * reporting counts, and the ProofAge consoles require it. `reason` is optional
   * free-text detail beside it.
   */
  async blockFace(data: BlockFacePayload = {}): Promise<null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const res = await this.client.makeRequest(
      'POST',
      `verifications/${this.verificationId}/blocked-face`,
      data as Record<string, unknown>,
    );
    return (await res.json()) as null;
  }
}
