import type { ProofAgeClient } from '../client.js';
import type {
  CreateWebhookSubscriptionPayload,
  WebhookSubscription,
  WebhookSubscriptionList,
} from '../types.js';

/**
 * Webhook subscriptions (REST hooks): URLs that receive the decision webhooks in addition to the
 * workspace webhook URL set in the console. Subscribe when an automation is turned on and
 * delete the subscription when it is turned off. A workspace can have up to 50.
 *
 * Each delivery has the workspace webhook's body and headers, signed with the secret key that
 * created the subscription while that key exists, then with the active secret key. A delivery
 * answered with `410 Gone` deletes the subscription.
 */
export class WebhookSubscriptionResource {
  constructor(private readonly client: ProofAgeClient) {}

  /**
   * Subscribe `url` to the decision webhooks, optionally only for some `statuses`. Without
   * `include_document_data: true` the deliveries leave out `document`, `fingerprint_signals`
   * and `manual_moderation.performed_by`.
   *
   * A 51st subscription throws a `ValidationError` with `code` `WEBHOOK_SUBSCRIPTION_LIMIT`.
   * Not retried on a 5xx, which may have created the subscription.
   */
  async create(data: CreateWebhookSubscriptionPayload): Promise<WebhookSubscription | null> {
    const res = await this.client.makeRequest('POST', 'webhook-subscriptions', data as unknown as Record<string, unknown>);
    return (await res.json()) as WebhookSubscription | null;
  }

  /** Every subscription of the workspace, newest first. */
  async list(): Promise<WebhookSubscriptionList | null> {
    const res = await this.client.makeRequest('GET', 'webhook-subscriptions');
    return (await res.json()) as WebhookSubscriptionList | null;
  }

  /**
   * Delete a subscription; deliveries already queued for it are not sent. The API answers
   * `204 No Content`, so this resolves to `null`. An unknown id throws a 404 `ProofAgeError`.
   * Retried like a POST: on a 429 or a connection that was never made, never on a 5xx.
   */
  async delete(id: string): Promise<null> {
    const res = await this.client.makeRequest('DELETE', `webhook-subscriptions/${encodeURIComponent(id)}`);
    await res.json();
    return null;
  }
}
