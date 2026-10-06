import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App } from '../../database/entities';

/**
 * Says so at boot when an app takes marketplace payments but the platform
 * account (XENDIT_PLATFORM_ACCOUNT_ID) is missing: every such payment would
 * fail at its fee split. Logged, not fatal — subscriptions keep working, and
 * the admin's Xendit check shows the same problem with how to fix it.
 */
@Injectable()
export class MarketplaceConfigCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(MarketplaceConfigCheck.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(App) private readonly apps: Repository<App>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const problem = await this.check();
    if (problem) this.logger.error(problem);
  }

  /** The problem in words, or null when there is none. */
  async check(): Promise<string | null> {
    if ((this.config.get<string>('XENDIT_PLATFORM_ACCOUNT_ID') ?? '').trim()) return null;
    let names: string[];
    try {
      names = (await this.apps.find({ where: { marketplaceEnabled: true, isActive: true }, select: { name: true } }))
        .map((a) => a.name);
    } catch {
      return null; // the database is not up yet; the health check reports that
    }
    if (names.length === 0) return null;
    return (
      `XENDIT_PLATFORM_ACCOUNT_ID is not set, but ${names.length} app(s) take marketplace payments ` +
      `(${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}). Their payments will fail at the fee split. ` +
      'Set it to your Xendit Business ID (Xendit dashboard → Settings → Business profile).'
    );
  }
}
