import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { LogAction, LogActor } from '../../common/enums';
import { App } from './app.entity';
import { Transaction } from './transaction.entity';

@Entity('transaction_logs')
@Index(['transactionId', 'createdAt'])
export class TransactionLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @ManyToOne(() => Transaction, (t) => t.logs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transaction_id' })
  transaction?: Transaction;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  @Index()
  @Column({ type: 'enum', enum: LogAction })
  action!: LogAction;

  @Column({ name: 'status_from', type: 'varchar', length: 32, nullable: true })
  statusFrom?: string | null;

  @Column({ name: 'status_to', type: 'varchar', length: 32, nullable: true })
  statusTo?: string | null;

  @Column({ type: 'enum', enum: LogActor, default: LogActor.System })
  actor!: LogActor;

  @Column({ name: 'provider_event_id', type: 'varchar', length: 200, nullable: true })
  providerEventId?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
