import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { App } from '../database/entities';
import { AuthedRequest } from './api-key.guard';

export const CurrentApp = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): App => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.acepayApp) {
      throw new Error('CurrentApp used on a route without ApiKeyGuard');
    }
    return req.acepayApp;
  },
);
