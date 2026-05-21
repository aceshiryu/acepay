import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import {
  Provider, Source, TransactionStatus, TransactionType,
} from '../../common/enums';
import { App } from './app.entity';
import { Customer } from './customer.entity';
import { Subscription } from './subscription.entity';
import { TransactionLog } from './transaction-log.entity';
import { WebhookEvent } from './webhook-event.entity';

@Entity('transactions')
@Unique('uq_tx_app_idem', ['appId', 'idempotencyKey'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, (a) => a.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null;

  @ManyToOne(() => Customer, (c) => c.transactions, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer | null;

  @Index()
  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId?: string | null;

  @ManyToOne(() => Subscription, (s) => s.transactions, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: Subscription | null;

  @Column({ type: 'enum', enum: Provider })
  provider!: Provider;

  @Index()
  @Column({ name: 'provider_tx_id', type: 'varchar', length: 200, nullable: true })
  providerTxId?: string | null;

  @Column({ type: 'enum', enum: TransactionType })
  type!: TransactionType;

  @Index()
  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.Pending })
  status!: TransactionStatus;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ length: 8 })
  currency!: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200, nullable: true })
  idempotencyKey?: string | null;

  @Column({ type: 'enum', enum: Source, nullable: true })
  source?: Source | null;

  @Column({ name: 'redirect_success', type: 'varchar', length: 500, nullable: true })
  redirectSuccess?: string | null;

  @Column({ name: 'redirect_failed', type: 'varchar', length: 500, nullable: true })
  redirectFailed?: string | null;

  @Column({ name: 'checkout_url', type: 'varchar', length: 500, nullable: true })
  checkoutUrl?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'provider_created_at', type: 'timestamptz', nullable: true })
  providerCreatedAt?: Date | null;

  @Column({ name: 'provider_completed_at', type: 'timestamptz', nullable: true })
  providerCompletedAt?: Date | null;

  @Column({ name: 'webhook_received_at', type: 'timestamptz', nullable: true })
  webhookReceivedAt?: Date | null;

  @Column({ name: 'app_notified_at', type: 'timestamptz', nullable: true })
  appNotifiedAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => TransactionLog, (l) => l.transaction)
  logs?: TransactionLog[];

  @OneToMany(() => WebhookEvent, (w) => w.transaction)
  webhookEvents?: WebhookEvent[];
}
