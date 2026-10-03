import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App } from '../database/entities';
import { apiKeyPrefix, sha256 } from '../common/crypto';
import { classifyApiKey } from './api-key-match';

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(App) private readonly apps: Repository<App>,
  ) {}

  async resolveByApiKey(rawKey: string): Promise<App | null> {
    const prefix = apiKeyPrefix(rawKey);
    const hash = sha256(rawKey);
    // The presented key may be the current key OR a previous key still in its
    // rotation grace window — those have different prefixes, so match on either.
    const candidates = await this.apps.find({
      where: [{ apiKeyPrefix: prefix }, { apiKeyPreviousPrefix: prefix }],
    });
    for (const candidate of candidates) {
      const match = classifyApiKey(candidate, hash);
      if (match === 'current' || match === 'previous') return candidate;
      // 'expired' means the key was recognized but is no longer valid — keep
      // looking (another app could share this 16-char prefix), but don't accept.
    }
    return null;
  }
}
