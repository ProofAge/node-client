import type { ProofAgeClient } from '../client.js';
import type { ConsentInfo, WorkspaceInfo } from '../types.js';

export class WorkspaceResource {
  constructor(private readonly client: ProofAgeClient) {}

  async get(): Promise<WorkspaceInfo | null> {
    const res = await this.client.makeRequest('GET', 'workspace');
    return (await res.json()) as WorkspaceInfo | null;
  }

  async getConsent(): Promise<ConsentInfo | null> {
    const res = await this.client.makeRequest('GET', 'consent');
    return (await res.json()) as ConsentInfo | null;
  }
}
