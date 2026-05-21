import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { Customer } from '../../database/entities';
import { CustomersAppController } from './customers-app.controller';
import { CustomersAppService } from './customers-app.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Customer])],
  controllers: [CustomersAppController],
  providers: [CustomersAppService],
  exports: [CustomersAppService],
})
export class CustomersAppModule {}
