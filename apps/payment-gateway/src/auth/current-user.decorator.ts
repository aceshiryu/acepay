import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { User } from '../database/entities';
import { AdminRequest } from './admin.guard';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    if (!req.adminUser) {
      throw new Error('CurrentUser used on a route without AdminGuard');
    }
    return req.adminUser;
  },
);
