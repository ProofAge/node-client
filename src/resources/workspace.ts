import type { ProofAgeClient } from '../client.js';

export class WorkspaceResource {
  constructor(private readonly client: ProofAgeClient) {}

  async get(): Promise<Record<string, unknown> | null> {
    const res = await this.client.makeRequest('GET', 'workspace');
    return (await res.json()) as Record<string, unknown> | null;
  }

  async getConsent(): Promise<Record<string, unknown> | null> {
    const res = await this.client.makeRequest('GET', 'consent');
    return (await res.json()) as Record<string, unknown> | null;
  }
}
