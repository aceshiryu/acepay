import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { TransactionLog } from '../../database/entities';
import { ActivityLogsAdminController } from './activity-logs-admin.controller';
import { ActivityLogsAdminService } from './activity-logs-admin.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([TransactionLog])],
  controllers: [ActivityLogsAdminController],
  providers: [ActivityLogsAdminService],
  exports: [ActivityLogsAdminService],
})
export class ActivityLogsAdminModule {}
