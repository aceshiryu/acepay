import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { App, User } from '../database/entities';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

@Module({
  imports: [TypeOrmModule.forFeature([App, User])],
  controllers: [AdminAuthController],
  providers: [ApiKeyService, ApiKeyGuard, AdminAuthService, AdminGuard],
  exports: [ApiKeyService, ApiKeyGuard, AdminAuthService, AdminGuard],
})
export class AuthModule {}
