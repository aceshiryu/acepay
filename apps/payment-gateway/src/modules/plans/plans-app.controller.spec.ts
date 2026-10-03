// The entity barrel has a circular import (App → Customer → Subscription →
// Plan → App) that swc-jest turns into a temporal-dead-zone error at load.
jest.mock('../../database/entities', () => ({
  App: class App {},
  Customer: class Customer {},
  Plan: class Plan {},
  Subscription: class Subscription {},
  Transaction: class Transaction {},
  TransactionLog: class TransactionLog {},
  User: class User {},
  WebhookEvent: class WebhookEvent {},
}));

import { App } from '../../database/entities';
import { PlansService } from './plans.service';
import { PlansAppController } from './plans-app.controller';

const CALLER = { id: 'app-1', slug: 'savi' } as App;

describe('PlansAppController (/v1/plans)', () => {
  let plans: { list: jest.Mock; findOne: jest.Mock };
  let controller: PlansAppController;

  beforeEach(() => {
    plans = { list: jest.fn().mockResolvedValue({ data: [] }), findOne: jest.fn() };
    controller = new PlansAppController(plans as unknown as PlansService);
  });

  it('scopes the listing to the calling app', async () => {
    await controller.list(CALLER, {});
    expect(plans.list).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1' }));
  });

  // PlansService.list is shared with the admin and only filters when asked.
  // That is right for an operator and wrong for an app: an app that showed a
  // deactivated plan would offer a customer something they cannot subscribe to.
  it('only ever returns active plans', async () => {
    await controller.list(CALLER, {});
    expect(plans.list).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('refuses a caller trying to ask for inactive plans', async () => {
    await controller.list(CALLER, { isActive: false } as never);
    expect(plans.list).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('passes other filters through untouched', async () => {
    await controller.list(CALLER, { interval: 'monthly' } as never);
    expect(plans.list).toHaveBeenCalledWith(expect.objectContaining({
      interval: 'monthly', appId: 'app-1', isActive: true,
    }));
  });

  it('scopes a single-plan read to the calling app', async () => {
    await controller.one(CALLER, 'plan-1');
    expect(plans.findOne).toHaveBeenCalledWith('plan-1', 'app-1');
  });
});
