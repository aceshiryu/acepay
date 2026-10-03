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

import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { App, Customer } from '../../database/entities';
import { CustomersAppService } from './customers-app.service';

const CALLER = { id: 'app-1', slug: 'savi' } as App;

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cus-1',
    appId: 'app-1',
    externalId: 'user_42',
    email: 'juan@email.com',
    name: 'Juan',
    metadata: {},
    ...overrides,
  } as Customer;
}

const DTO = { externalId: 'user_42', email: 'juan@email.com', name: 'Juan' };

describe('CustomersAppService (/v1/customers)', () => {
  let customers: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let service: CustomersAppService;

  beforeEach(() => {
    customers = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((c) => c),
      save: jest.fn((c) => Promise.resolve({ id: 'cus-new', ...c })),
    };
    service = new CustomersAppService(customers as unknown as Repository<Customer>);
  });

  describe('tenant isolation', () => {
    // Both upsert match arms carry appId — without it, one app's upsert could
    // adopt or overwrite another app's customer row.
    it('scopes both upsert match arms to the calling app', async () => {
      await service.upsert(CALLER, DTO);
      expect(customers.findOne).toHaveBeenCalledWith({
        where: [
          { appId: 'app-1', externalId: 'user_42' },
          { appId: 'app-1', email: 'juan@email.com' },
        ],
      });
    });

    it('scopes findOne to the calling app', async () => {
      customers.findOne.mockResolvedValue(customer());
      await service.findOne(CALLER, 'cus-1');
      expect(customers.findOne).toHaveBeenCalledWith({ where: { id: 'cus-1', appId: 'app-1' } });
    });

    it('reports another app’s customer as not found', async () => {
      customers.findOne.mockResolvedValue(null);
      try {
        await service.findOne(CALLER, 'cus-of-other-app');
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).getResponse()).toEqual({
          error: 'customer_not_found',
          message: 'Customer cus-of-other-app not found',
        });
      }
    });

    it('stamps a newly created customer with the calling app', async () => {
      await service.upsert(CALLER, DTO);
      expect(customers.create.mock.calls[0][0].appId).toBe('app-1');
    });
  });

  describe('creating a new customer', () => {
    it('normalizes the email to lowercase', async () => {
      await service.upsert(CALLER, { ...DTO, email: 'JUAN@Email.COM' });
      expect(customers.create.mock.calls[0][0].email).toBe('juan@email.com');
    });

    it('defaults an absent name to null and metadata to an empty object', async () => {
      await service.upsert(CALLER, { externalId: 'user_42', email: 'juan@email.com' });
      expect(customers.create).toHaveBeenCalledWith(expect.objectContaining({
        name: null, metadata: {},
      }));
    });

    it('keeps supplied metadata', async () => {
      await service.upsert(CALLER, { ...DTO, metadata: { plan: 'pro' } });
      expect(customers.create.mock.calls[0][0].metadata).toEqual({ plan: 'pro' });
    });

    it('returns the persisted row', async () => {
      await expect(service.upsert(CALLER, DTO)).resolves.toMatchObject({ id: 'cus-new' });
    });
  });

  // Found live: three concurrent subscribes for the same inline customer all
  // passed the lookup, then two lost on uq_customers_app_email and surfaced a
  // raw constraint violation as a 500. A customer double-clicking subscribe is
  // exactly this.
  describe('concurrent creation', () => {
    it('reads the winner back instead of surfacing a constraint violation', async () => {
      const winner = customer();
      customers.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      customers.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      await expect(service.upsert(CALLER, DTO)).resolves.toBe(winner);
    });

    it('recognises the violation when the driver nests the code', async () => {
      const winner = customer();
      customers.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      customers.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { driverError: { code: '23505' } }),
      );
      await expect(service.upsert(CALLER, DTO)).resolves.toBe(winner);
    });

    it('looks the winner up on both match arms, still scoped to the app', async () => {
      customers.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(customer());
      customers.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
      await service.upsert(CALLER, DTO);
      expect(customers.findOne).toHaveBeenLastCalledWith({
        where: [
          { appId: 'app-1', externalId: 'user_42' },
          { appId: 'app-1', email: 'juan@email.com' },
        ],
      });
    });

    it('rethrows a save failure that is not a uniqueness violation', async () => {
      customers.findOne.mockResolvedValue(null);
      customers.save.mockRejectedValueOnce(
        Object.assign(new Error('connection terminated'), { code: '08006' }),
      );
      await expect(service.upsert(CALLER, DTO)).rejects.toThrow('connection terminated');
    });

    it('rethrows when the violation leaves nothing to read back', async () => {
      customers.findOne.mockResolvedValue(null);
      customers.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
      await expect(service.upsert(CALLER, DTO)).rejects.toThrow('dup');
    });
  });

  // The upsert is what makes POST /v1/customers and inline subscription
  // customers safe to retry — a repeat call must update, never duplicate.
  describe('updating an existing customer', () => {
    it('updates in place instead of creating a duplicate', async () => {
      const existing = customer();
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, DTO);
      expect(customers.create).not.toHaveBeenCalled();
      expect(customers.save).toHaveBeenCalledWith(existing);
    });

    it('lowercases the email on update too', async () => {
      const existing = customer();
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, { ...DTO, email: 'NEW@Email.COM' });
      expect(existing.email).toBe('new@email.com');
    });

    // Matching on email means a customer found by email gets their externalId
    // (re)written — that is how an app back-fills its own user id.
    it('writes the externalId onto a row matched by email', async () => {
      const existing = customer({ externalId: 'legacy_id' });
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, { ...DTO, externalId: 'user_99' });
      expect(existing.externalId).toBe('user_99');
    });

    it('updates the name when one is supplied', async () => {
      const existing = customer({ name: 'Old Name' });
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, { ...DTO, name: 'New Name' });
      expect(existing.name).toBe('New Name');
    });

    it('preserves the stored name when the caller omits it', async () => {
      const existing = customer({ name: 'Existing Name' });
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, { externalId: 'user_42', email: 'juan@email.com' });
      expect(existing.name).toBe('Existing Name');
    });

    // `undefined` means "leave it alone"; an explicit empty string is a real
    // value the caller chose, so it must land.
    it('accepts an explicit empty name as a deliberate clear', async () => {
      const existing = customer({ name: 'Existing Name' });
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, { ...DTO, name: '' });
      expect(existing.name).toBe('');
    });

    it('merges metadata rather than replacing it', async () => {
      const existing = customer({ metadata: { plan: 'free', locale: 'en' } });
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, { ...DTO, metadata: { plan: 'pro' } });
      expect(existing.metadata).toEqual({ plan: 'pro', locale: 'en' });
    });

    it('leaves stored metadata untouched when none is supplied', async () => {
      const existing = customer({ metadata: { plan: 'free' } });
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, DTO);
      expect(existing.metadata).toEqual({ plan: 'free' });
    });

    it('treats an empty metadata object as nothing to merge', async () => {
      const existing = customer({ metadata: { plan: 'free' } });
      customers.findOne.mockResolvedValue(existing);
      await service.upsert(CALLER, { ...DTO, metadata: {} });
      expect(existing.metadata).toEqual({ plan: 'free' });
    });

    it('is stable across repeated identical calls', async () => {
      const existing = customer();
      customers.findOne.mockResolvedValue(existing);
      const first = await service.upsert(CALLER, DTO);
      const second = await service.upsert(CALLER, DTO);
      expect(second).toEqual(first);
      expect(customers.create).not.toHaveBeenCalled();
    });
  });
});
