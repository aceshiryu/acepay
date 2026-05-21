import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { WebhookEvent } from '../../database/entities';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsAdminService } from './settings-admin.service';

@Module({
  imports: [AuthModule, WebhooksModule, TypeOrmModule.forFeature([WebhookEvent])],
  controllers: [SettingsAdminController],
  providers: [SettingsAdminService],
})
export class SettingsAdminModule {}
