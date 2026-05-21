import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { signJwt, verifyJwt, verifyPassword } from '../common/crypto';
import { User } from '../database/entities';

export interface AdminTokenPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect',
      });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect',
      });
    }
    user.lastLoginAt = new Date();
    await this.users.save(user);
    return { token: this.issueToken(user), user };
  }

  issueToken(user: User): string {
    const ttlHours = Number(this.config.get<string>('ADMIN_JWT_TTL_HOURS') ?? 12);
    return signJwt({ sub: user.id, email: user.email }, this.requireSecret(), ttlHours * 3600);
  }

  verifyToken(token: string): AdminTokenPayload | null {
    return verifyJwt<AdminTokenPayload>(token, this.requireSecret());
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  private requireSecret(): string {
    const secret = this.config.get<string>('ADMIN_JWT_SECRET');
    if (!secret) {
      throw new Error('ADMIN_JWT_SECRET env var is required');
    }
    return secret;
  }
}
