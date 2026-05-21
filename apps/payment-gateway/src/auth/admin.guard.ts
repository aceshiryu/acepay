import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { User } from '../database/entities';
import { AdminAuthService } from './admin-auth.service';

export interface AdminRequest extends Request {
  adminUser?: User;
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const header = req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        error: 'missing_token',
        message: 'Authorization: Bearer <token> header is required',
      });
    }
    const token = header.slice(7).trim();
    const payload = this.auth.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException({
        error: 'invalid_token',
        message: 'Token is invalid or expired',
      });
    }
    const user = await this.auth.getUser(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        error: 'user_inactive',
        message: 'Admin user is no longer active',
      });
    }
    req.adminUser = user;
    return true;
  }
}
