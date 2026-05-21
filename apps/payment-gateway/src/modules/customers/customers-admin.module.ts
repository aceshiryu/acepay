import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { Customer, Subscription, Transaction } from '../../database/entities';
import { CustomersAdminController } from './customers-admin.controller';
import { CustomersAdminService } from './customers-admin.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Customer, Subscription, Transaction]),
  ],
  controllers: [CustomersAdminController],
  providers: [CustomersAdminService],
  exports: [CustomersAdminService],
})
export class CustomersAdminModule {}
