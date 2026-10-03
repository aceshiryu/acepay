import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { XenditSplitRule } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';

/**
 * One Xendit split rule per fee rate, created on first use and reused by every
 * app and merchant on that rate. The rule routes the fee to the platform
 * account; the invoice itself is created on the merchant's sub-account.
 */
@Injectable()
export class SplitRulesService {
  constructor(
    @InjectRepository(XenditSplitRule) private readonly rules: Repository<XenditSplitRule>,
    private readonly xendit: XenditPlatformClient,
  ) {}

  async getOrCreate(percent: number, currency: string): Promise<string> {
    const destinationAccountId = this.xendit.platformAccountId();
    const cur = currency.toUpperCase();
    const where = { percent, currency: cur, destinationAccountId };
    const existing = await this.rules.findOne({ where });
    if (existing) return existing.xenditSplitRuleId;

    const xenditSplitRuleId = await this.xendit.createPlatformFeeSplitRule({ percent, currency: cur });
    try {
      await this.rules.insert({ percent, currency: cur, destinationAccountId, xenditSplitRuleId });
      return xenditSplitRuleId;
    } catch (err) {
      // Two first payments at a new rate raced: keep the stored rule. The
      // loser's rule stays unused on Xendit, which is harmless.
      if (err instanceof QueryFailedError) {
        const winner = await this.rules.findOne({ where });
        if (winner) return winner.xenditSplitRuleId;
      }
      throw err;
    }
  }
}
