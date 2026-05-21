import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRoot(dataSourceOptions),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
