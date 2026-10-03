jest.mock('../../database/entities', () => ({ XenditSplitRule: class XenditSplitRule {} }));

import { QueryFailedError, Repository } from 'typeorm';
import { XenditSplitRule } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import { SplitRulesService } from './split-rules.service';

describe('SplitRulesService', () => {
  let rules: { findOne: jest.Mock; insert: jest.Mock };
  let xendit: { platformAccountId: jest.Mock; createPlatformFeeSplitRule: jest.Mock };
  let service: SplitRulesService;

  beforeEach(() => {
    rules = { findOne: jest.fn().mockResolvedValue(null), insert: jest.fn().mockResolvedValue(undefined) };
    xendit = {
      platformAccountId: jest.fn().mockReturnValue('master-1'),
      createPlatformFeeSplitRule: jest.fn().mockResolvedValue('splitru_new'),
    };
    service = new SplitRulesService(rules as unknown as Repository<XenditSplitRule>, xendit as unknown as XenditPlatformClient);
  });

  it('reuses the stored rule for a rate (one rule shared by every merchant on 12%)', async () => {
    rules.findOne.mockResolvedValue({ xenditSplitRuleId: 'splitru_12' });
    expect(await service.getOrCreate(12, 'php')).toBe('splitru_12');
    expect(rules.findOne).toHaveBeenCalledWith({ where: { percent: 12, currency: 'PHP', destinationAccountId: 'master-1' } });
    expect(xendit.createPlatformFeeSplitRule).not.toHaveBeenCalled();
  });

  it('creates and stores a rule for a new rate', async () => {
    expect(await service.getOrCreate(10, 'PHP')).toBe('splitru_new');
    expect(xendit.createPlatformFeeSplitRule).toHaveBeenCalledWith({ percent: 10, currency: 'PHP' });
    expect(rules.insert).toHaveBeenCalledWith({ percent: 10, currency: 'PHP', destinationAccountId: 'master-1', xenditSplitRuleId: 'splitru_new' });
  });

  it('keeps the winner when two first payments race on a new rate', async () => {
    rules.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ xenditSplitRuleId: 'splitru_winner' });
    rules.insert.mockRejectedValue(new QueryFailedError('INSERT', [], new Error('duplicate key')));
    expect(await service.getOrCreate(12, 'PHP')).toBe('splitru_winner');
  });
});
