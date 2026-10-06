jest.mock('../../database/entities', () => ({
  App: class App {}, Customer: class Customer {}, Plan: class Plan {}, Subscription: class Subscription {},
  Transaction: class Transaction {}, TransactionLog: class TransactionLog {}, User: class User {},
  WebhookEvent: class WebhookEvent {}, Merchant: class Merchant {}, Payout: class Payout {},
  PayoutRun: class PayoutRun {}, XenditSplitRule: class XenditSplitRule {}, PlatformSetting: class PlatformSetting {},
}));

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MerchantStatus } from '../../common/enums';
import { App, Merchant, Payout } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import { MerchantEventsService } from './merchant-events.service';
import { ACTIVATION_RECHECK_MS, MerchantsService } from './merchants.service';
import { payoutDestinationHash } from './marketplace.util';

const BOOKLY = { id: 'app-bookly', name: 'BooklyPH', marketplaceEnabled: true, marketplaceFeePercent: 12, marketplaceMinPayout: 50000 } as App;

function merchantRow(o: Partial<Merchant> = {}): Merchant {
  return {
    id: 'm-1', appId: BOOKLY.id, externalRef: 'coach_42', name: 'Coach Juan', email: 'juan@x.com',
    status: MerchantStatus.Active, xenditAccountId: 'sub-1', xenditAccountStatus: 'LIVE',
    payoutChannelCode: 'PH_GCASH', payoutAccountNumber: '09171234567', payoutAccountHolderName: 'Juan Dela Cruz',
    metadata: {}, createdAt: new Date(), updatedAt: new Date(), ...o,
  } as Merchant;
}

describe('MerchantsService', () => {
  let merchants: Record<string, jest.Mock>;
  let payouts: Record<string, jest.Mock>;
  let apps: Record<string, jest.Mock>;
  let xendit: Record<string, jest.Mock>;
  let events: { emit: jest.Mock };
  let qb: Record<string, jest.Mock>;
  let service: MerchantsService;

  beforeEach(() => {
    qb = {
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getRawOne: jest.fn().mockResolvedValue({ sum: '0' }),
    };
    merchants = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((m) => ({ ...m })),
      save: jest.fn((m) => Promise.resolve(Object.assign(m, { id: m.id ?? 'm-new', createdAt: new Date(), updatedAt: new Date() }))),
      delete: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => qb),
    };
    payouts = { createQueryBuilder: jest.fn(() => qb) };
    apps = { findOneByOrFail: jest.fn().mockResolvedValue(BOOKLY) };
    xendit = {
      createOwnedAccount: jest.fn().mockResolvedValue({ id: 'sub-new', status: 'LIVE', raw: {} }),
      getAccount: jest.fn(),
      getBalance: jest.fn().mockResolvedValue(500000),
      payoutFeeReserve: jest.fn().mockReturnValue(2500),
    };
    events = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new MerchantsService(
      merchants as unknown as Repository<Merchant>,
      payouts as unknown as Repository<Payout>,
      apps as unknown as Repository<App>,
      xendit as unknown as XenditPlatformClient,
      events as unknown as MerchantEventsService,
    );
  });

  describe('create', () => {
    const dto = {
      externalRef: 'coach_42', name: 'Coach Juan', email: 'juan@x.com',
      payoutChannelCode: 'ph_gcash', payoutAccountNumber: ' 09171234567 ', payoutAccountHolderName: 'Juan Dela Cruz',
    };

    it('creates the merchant + an OWNED sub-account; active when Xendit says LIVE', async () => {
      const view = await service.create(BOOKLY, dto);
      expect(xendit.createOwnedAccount).toHaveBeenCalledWith({ email: 'juan@x.com', businessName: 'Coach Juan' });
      expect(view).toEqual(expect.objectContaining({
        id: 'm-new', status: MerchantStatus.Active, feePercent: 12,
        payoutChannelCode: 'PH_GCASH', payoutAccount: '•••• 4567', hasPayoutDestination: true,
      }));
      const saved = merchants.save.mock.calls.at(-1)![0];
      expect(saved.xenditAccountId).toBe('sub-new');
      expect(saved.payoutAccountNumber).toBe('09171234567');
      expect(saved.payoutDestinationHash).toBe(payoutDestinationHash('PH_GCASH', '09171234567'));
      expect(view).not.toHaveProperty('payoutAccountNumber');
    });

    it('stays pending when the sub-account is not LIVE yet — and looks again a few seconds later', async () => {
      jest.useFakeTimers();
      try {
        xendit.createOwnedAccount.mockResolvedValue({ id: 'sub-new', status: 'REGISTERED', raw: {} });
        const view = await service.create(BOOKLY, dto);
        expect(view.status).toBe(MerchantStatus.Pending);

        const saved = merchants.save.mock.calls.at(-1)![0];
        merchants.findOne.mockResolvedValue({ ...saved });
        xendit.getAccount.mockResolvedValue({ id: 'sub-new', status: 'LIVE', raw: {} });
        expect(xendit.getAccount).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(ACTIVATION_RECHECK_MS);
        expect(xendit.getAccount).toHaveBeenCalledWith('sub-new');
        expect(merchants.save.mock.calls.at(-1)![0].status).toBe(MerchantStatus.Active);
        expect(events.emit).toHaveBeenCalledWith('merchant.activated', expect.anything(), expect.anything());
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not schedule a re-check when Xendit says LIVE straight away', async () => {
      jest.useFakeTimers();
      try {
        await service.create(BOOKLY, dto);
        await jest.advanceTimersByTimeAsync(ACTIVATION_RECHECK_MS);
        expect(xendit.getAccount).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('allows onboarding without payout details', async () => {
      const view = await service.create(BOOKLY, { externalRef: 'c', name: 'C', email: 'c@x.com' });
      expect(view.hasPayoutDestination).toBe(false);
    });

    it('rejects half-filled payout details', async () => {
      await expect(service.create(BOOKLY, { ...dto, payoutAccountHolderName: undefined }))
        .rejects.toMatchObject({ response: { error: 'incomplete_payout_destination' } });
      expect(xendit.createOwnedAccount).not.toHaveBeenCalled();
    });

    it('409s a duplicate externalRef within the app', async () => {
      merchants.findOne.mockResolvedValue(merchantRow());
      await expect(service.create(BOOKLY, dto)).rejects.toBeInstanceOf(ConflictException);
      expect(xendit.createOwnedAccount).not.toHaveBeenCalled();
    });

    it('removes the claim when Xendit fails, so the app can retry', async () => {
      xendit.createOwnedAccount.mockRejectedValue(new Error('Xendit POST /v2/accounts failed (503)'));
      await expect(service.create(BOOKLY, dto)).rejects.toThrow(/Xendit/);
      expect(merchants.delete).toHaveBeenCalledWith({ id: 'm-new' });
    });

    it('requires marketplace mode', async () => {
      await expect(service.create({ ...BOOKLY, marketplaceEnabled: false } as App, dto)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('tenant boundary', () => {
    it("scopes lookups by the calling app and 404s another app's merchant", async () => {
      await expect(service.findOne(BOOKLY, 'm-other')).rejects.toBeInstanceOf(NotFoundException);
      expect(merchants.findOne).toHaveBeenCalledWith({ where: { id: 'm-other', appId: BOOKLY.id } });
    });

    it.each(['update', 'balance', 'listPayouts'] as const)('%s is scoped too', async (method) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any)[method](BOOKLY, 'm-other', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(merchants.findOne).toHaveBeenCalledWith({ where: { id: 'm-other', appId: BOOKLY.id } });
    });

    it('list filters on the calling app', async () => {
      await service.list(BOOKLY, {});
      expect(qb.where).toHaveBeenCalledWith('m.app_id = :appId', { appId: BOOKLY.id });
    });
  });

  describe('update (app)', () => {
    it('re-hashes a new payout destination', async () => {
      const m = merchantRow();
      merchants.findOne.mockResolvedValue(m);
      await service.update(BOOKLY, 'm-1', { payoutAccountNumber: '09998887777' });
      expect(m.payoutAccountNumber).toBe('09998887777');
      expect(m.payoutDestinationHash).toBe(payoutDestinationHash('PH_GCASH', '09998887777'));
    });
  });

  describe('balance', () => {
    it('reports payable = balance − payout-fee reserve, plus in-flight payouts', async () => {
      merchants.findOne.mockResolvedValue(merchantRow());
      qb.getRawOne.mockResolvedValue({ sum: '10000' });
      const b = await service.balance(BOOKLY, 'm-1');
      expect(xendit.getBalance).toHaveBeenCalledWith('sub-1', 'PHP');
      expect(b).toEqual({ merchantId: 'm-1', currency: 'PHP', available: 500000, payable: 497500, inFlight: 10000, minPayout: 50000 });
    });

    it('never reports a negative payable', async () => {
      merchants.findOne.mockResolvedValue(merchantRow());
      xendit.getBalance.mockResolvedValue(1000);
      expect((await service.balance(BOOKLY, 'm-1')).payable).toBe(0);
    });
  });

  describe('adminUpdate', () => {
    beforeEach(() => {
      merchants.find.mockResolvedValue([]);
    });

    it.each([
      [MerchantStatus.Active, MerchantStatus.Paused],
      [MerchantStatus.Paused, MerchantStatus.Active],
    ])('allows %s → %s', async (from, to) => {
      const m = merchantRow({ status: from, app: BOOKLY } as Partial<Merchant>);
      merchants.findOne.mockResolvedValue(m);
      await service.adminUpdate('m-1', { status: to });
      expect(m.status).toBe(to);
    });

    it.each([
      [MerchantStatus.Pending, MerchantStatus.Active],
      [MerchantStatus.Suspended, MerchantStatus.Active],
      [MerchantStatus.Active, MerchantStatus.Suspended],
    ])('refuses %s → %s', async (from, to) => {
      merchants.findOne.mockResolvedValue(merchantRow({ status: from, app: BOOKLY } as Partial<Merchant>));
      await expect(service.adminUpdate('m-1', { status: to })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sets and clears a founding-coach fee override', async () => {
      const m = merchantRow({ app: BOOKLY } as Partial<Merchant>);
      merchants.findOne.mockResolvedValue(m);
      await service.adminUpdate('m-1', { feeOverridePercent: 10, feeOverrideEndsAt: '2027-04-01T00:00:00Z' });
      expect(m.feeOverridePercent).toBe(10);
      expect(m.feeOverrideEndsAt).toEqual(new Date('2027-04-01T00:00:00Z'));
      await service.adminUpdate('m-1', { feeOverridePercent: null });
      expect(m.feeOverridePercent).toBeNull();
      expect(m.feeOverrideEndsAt).toBeNull();
    });
  });

  describe('admin views', () => {
    it('flags the same destination within an app and counts other apps', async () => {
      const hash = payoutDestinationHash('PH_GCASH', '09171234567');
      const m = merchantRow({ payoutDestinationHash: hash, app: BOOKLY } as Partial<Merchant>);
      qb.getManyAndCount.mockResolvedValue([[m], 1]);
      merchants.find.mockResolvedValue([
        { id: 'm-1', appId: BOOKLY.id, payoutDestinationHash: hash },
        { id: 'm-2', appId: BOOKLY.id, payoutDestinationHash: hash },
        { id: 'm-3', appId: 'app-other', payoutDestinationHash: hash },
      ]);
      const page = await service.adminList({});
      expect(page.data[0]).toEqual(expect.objectContaining({ duplicateDestinationInApp: true, sharedDestinationOtherApps: 1 }));
    });

    it('does not flag a destination shared only with another app', async () => {
      const hash = 'h';
      const m = merchantRow({ payoutDestinationHash: hash, app: BOOKLY } as Partial<Merchant>);
      qb.getManyAndCount.mockResolvedValue([[m], 1]);
      merchants.find.mockResolvedValue([
        { id: 'm-1', appId: BOOKLY.id, payoutDestinationHash: hash },
        { id: 'm-9', appId: 'app-other', payoutDestinationHash: hash },
      ]);
      const page = await service.adminList({});
      expect(page.data[0]).toEqual(expect.objectContaining({ duplicateDestinationInApp: false, sharedDestinationOtherApps: 1 }));
    });
  });

  describe('applyAccountStatus', () => {
    it('activates a pending merchant on LIVE and tells the app', async () => {
      const m = merchantRow({ status: MerchantStatus.Pending });
      await service.applyAccountStatus(m, 'live');
      expect(m.status).toBe(MerchantStatus.Active);
      expect(events.emit).toHaveBeenCalledWith('merchant.activated', m, expect.any(Object));
    });

    it('suspends on SUSPENDED and tells the app', async () => {
      const m = merchantRow();
      await service.applyAccountStatus(m, 'SUSPENDED');
      expect(m.status).toBe(MerchantStatus.Suspended);
      expect(events.emit).toHaveBeenCalledWith('merchant.suspended', m, expect.any(Object));
    });

    it('never un-pauses an operator-paused merchant', async () => {
      const m = merchantRow({ status: MerchantStatus.Paused });
      await service.applyAccountStatus(m, 'LIVE');
      expect(m.status).toBe(MerchantStatus.Paused);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('is quiet when nothing changes', async () => {
      const m = merchantRow();
      await service.applyAccountStatus(m, 'LIVE');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('activatePending — the worker sweep', () => {
    it('activates pending sub-accounts Xendit has made LIVE, and leaves the rest pending', async () => {
      const live = { id: 'm1', status: MerchantStatus.Pending, xenditAccountId: 'sub-1', appId: BOOKLY.id };
      const notYet = { id: 'm2', status: MerchantStatus.Pending, xenditAccountId: 'sub-2', appId: BOOKLY.id };
      merchants.find.mockResolvedValue([live, notYet]);
      merchants.findOne.mockImplementation(async ({ where }: { where: { id: string } }) => ({ ...(where.id === 'm1' ? live : notYet) }));
      xendit.getAccount.mockImplementation(async (id: string) => ({ id, status: id === 'sub-1' ? 'LIVE' : 'REGISTERED', raw: {} }));
      expect(await service.activatePending(new Date('2026-10-05T00:00:00Z'))).toEqual({ checked: 2, activated: 1 });
      const where = merchants.find.mock.calls[0][0].where;
      expect(where.status).toBe(MerchantStatus.Pending);
      expect(merchants.find.mock.calls[0][0].take).toBe(20);
    });

    it('one failing account never stops the sweep', async () => {
      merchants.find.mockResolvedValue([
        { id: 'm1', status: MerchantStatus.Pending, xenditAccountId: 'sub-1' },
        { id: 'm2', status: MerchantStatus.Pending, xenditAccountId: 'sub-2' },
      ]);
      merchants.findOne.mockImplementation(async ({ where }: { where: { id: string } }) => ({
        id: where.id, status: MerchantStatus.Pending, xenditAccountId: where.id === 'm1' ? 'sub-1' : 'sub-2', appId: BOOKLY.id,
      }));
      xendit.getAccount.mockImplementation(async (id: string) => {
        if (id === 'sub-1') throw new Error('Xendit 503');
        return { id, status: 'LIVE', raw: {} };
      });
      expect(await service.activatePending()).toEqual({ checked: 2, activated: 1 });
    });
  });

  describe('syncAccount', () => {
    it('creates the sub-account if an earlier attempt never did', async () => {
      const m = merchantRow({ xenditAccountId: null, status: MerchantStatus.Pending, app: BOOKLY } as Partial<Merchant>);
      merchants.findOne.mockResolvedValue(m);
      await service.syncAccount('m-1');
      expect(xendit.createOwnedAccount).toHaveBeenCalled();
      expect(m.xenditAccountId).toBe('sub-new');
    });

    it('re-reads an existing sub-account', async () => {
      const m = merchantRow({ status: MerchantStatus.Pending, app: BOOKLY } as Partial<Merchant>);
      merchants.findOne.mockResolvedValue(m);
      xendit.getAccount.mockResolvedValue({ id: 'sub-1', status: 'LIVE', raw: {} });
      await service.syncAccount('m-1');
      expect(m.status).toBe(MerchantStatus.Active);
    });
  });
});
