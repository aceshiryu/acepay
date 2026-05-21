import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { App } from '../database/entities';
import { ApiKeyService } from './api-key.service';

export interface AuthedRequest extends Request {
  acepayApp?: App;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const headerKey = req.header('x-api-key');
    if (!headerKey) {
      throw new UnauthorizedException({
        error: 'missing_api_key',
        message: 'x-api-key header is required',
      });
    }

    const app = await this.apiKeys.resolveByApiKey(headerKey);
    if (!app) {
      throw new UnauthorizedException({
        error: 'invalid_api_key',
        message: 'API key is not recognized',
      });
    }
    if (!app.isActive) {
      throw new ForbiddenException({
        error: 'app_inactive',
        message: `App ${app.slug} is deactivated`,
      });
    }

    req.acepayApp = app;
    return true;
  }
}
