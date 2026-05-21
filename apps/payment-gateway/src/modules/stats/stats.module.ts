import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import {
  App, Subscription, Transaction, WebhookEvent,
} from '../../database/entities';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([App, Transaction, Subscription, WebhookEvent]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
