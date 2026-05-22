// Side-effect import — runs dotenv.config() at import time, before TypeORM
// reads env. Goes first so it runs before any other code in this module.
import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as Entities from './entities';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER     ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME     ?? 'acepay',
  entities: Object.values(Entities),
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsTableName: 'acepay_migrations',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

export default new DataSource(dataSourceOptions);
