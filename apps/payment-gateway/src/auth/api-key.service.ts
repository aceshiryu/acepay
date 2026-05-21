import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App } from '../database/entities';
import { apiKeyPrefix, sha256 } from '../common/crypto';

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(App) private readonly apps: Repository<App>,
  ) {}

  async resolveByApiKey(rawKey: string): Promise<App | null> {
    const prefix = apiKeyPrefix(rawKey);
    const hash = sha256(rawKey);
    const candidates = await this.apps.find({ where: { apiKeyPrefix: prefix } });
    for (const candidate of candidates) {
      if (candidate.apiKeyHash === hash) return candidate;
    }
    return null;
  }
}
