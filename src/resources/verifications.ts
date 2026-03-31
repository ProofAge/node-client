import type { ProofAgeClient } from '../client.js';
import type { AcceptConsentPayload, CreateVerificationPayload, UploadMediaPayload } from '../types.js';

export class VerificationResource {
  constructor(
    private readonly client: ProofAgeClient,
    private readonly verificationId?: string,
  ) {}

  async create(data: CreateVerificationPayload): Promise<Record<string, unknown> | null> {
    const res = await this.client.makeRequest('POST', 'verifications', data as Record<string, unknown>);
    return (await res.json()) as Record<string, unknown> | null;
  }

  async find(id: string): Promise<Record<string, unknown> | null> {
    const res = await this.client.makeRequest('GET', `verifications/${id}`);
    return (await res.json()) as Record<string, unknown> | null;
  }

  async get(): Promise<Record<string, unknown> | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    return this.find(this.verificationId);
  }

  async acceptConsent(data: AcceptConsentPayload): Promise<Record<string, unknown> | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const res = await this.client.makeRequest(
      'POST',
      `verifications/${this.verificationId}/consent`,
      data as unknown as Record<string, unknown>,
    );
    return (await res.json()) as Record<string, unknown> | null;
  }

  async uploadMedia(data: UploadMediaPayload): Promise<Record<string, unknown> | null> {
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
    return (await res.json()) as Record<string, unknown> | null;
  }

  async submit(): Promise<Record<string, unknown> | null> {
    if (!this.verificationId) {
      throw new TypeError('Verification ID is required');
    }
    const res = await this.client.makeRequest('POST', `verifications/${this.verificationId}/submit`, {});
    return (await res.json()) as Record<string, unknown> | null;
  }
}
