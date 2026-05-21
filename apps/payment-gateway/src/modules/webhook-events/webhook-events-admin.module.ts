import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { CommonServicesModule } from '../../common/services/common-services.module';
import { WebhookEvent } from '../../database/entities';
import { WebhookEventsAdminController } from './webhook-events-admin.controller';
import { WebhookEventsAdminService } from './webhook-events-admin.service';

@Module({
  imports: [AuthModule, CommonServicesModule, TypeOrmModule.forFeature([WebhookEvent])],
  controllers: [WebhookEventsAdminController],
  providers: [WebhookEventsAdminService],
  exports: [WebhookEventsAdminService],
})
export class WebhookEventsAdminModule {}
