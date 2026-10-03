jest.mock('../../database/entities', () => ({ WebhookEvent: class WebhookEvent {} }));

import { Repository } from 'typeorm';
import { MerchantStatus, PayoutStatus, Provider, WebhookDeliveryStatus } from '../../common/enums';
import { WebhookDeliveryQueueService } from '../../common/queue/webhook-delivery-queue.service';
import { Merchant, Payout, WebhookEvent } from '../../database/entities';
import { MerchantEventsService } from './merchant-events.service';

describe('MerchantEventsService', () => {
  let webhooks: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let queue: { enqueue: jest.Mock };
  let service: MerchantEventsService;
  const merchant = { id: 'm-1', appId: 'app-bookly', externalRef: 'coach_42', status: MerchantStatus.Active } as Merchant;
  const payout = {
    id: 'po-1', runId: 'run-1', amount: 482500, currency: 'PHP', status: PayoutStatus.Succeeded,
    channelCode: 'PH_GCASH', accountNumber: '09171234567', failureCode: null,
  } as unknown as Payout;

  beforeEach(() => {
    webhooks = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((e) => e),
      save: jest.fn((e) => Promise.resolve({ ...e, id: 'evt-1' })),
    };
    queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new MerchantEventsService(webhooks as unknown as Repository<WebhookEvent>, queue as unknown as WebhookDeliveryQueueService);
  });

  it("stores a signed-delivery event for the merchant's app with a masked account", async () => {
    await service.emit('merchant.payout_sent', merchant, { eventKey: 'po-1_succeeded', payout });
    const stored = webhooks.create.mock.calls[0][0];
    expect(stored).toEqual(expect.objectContaining({
      appId: 'app-bookly', provider: Provider.Xendit, eventType: 'merchant.payout_sent',
      providerEventId: 'acepay_merchant.payout_sent_po-1_succeeded', deliveryStatus: WebhookDeliveryStatus.Pending,
    }));
    expect(stored.normalizedPayload).toEqual(expect.objectContaining({
      event: 'merchant.payout_sent', merchant_id: 'm-1', external_ref: 'coach_42',
      payout: expect.objectContaining({ id: 'po-1', amount: 482500, account: '•••• 4567', status: PayoutStatus.Succeeded }),
    }));
    expect(JSON.stringify(stored.normalizedPayload)).not.toContain('09171234567');
    expect(queue.enqueue).toHaveBeenCalledWith({ webhookEventId: 'evt-1', transactionId: null });
  });

  it('never notifies twice for the same event key', async () => {
    webhooks.findOne.mockResolvedValue({ id: 'evt-old' });
    await service.emit('merchant.payout_sent', merchant, { eventKey: 'po-1_succeeded', payout });
    expect(webhooks.save).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('swallows a lost insert race', async () => {
    webhooks.save.mockRejectedValue(new Error('duplicate key uq_webhook_provider_event'));
    await expect(service.emit('merchant.activated', merchant, { eventKey: 'k' })).resolves.toBeUndefined();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
