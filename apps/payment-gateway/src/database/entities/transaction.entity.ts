import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import {
  Provider, Source, TransactionStatus, TransactionType,
} from '../../common/enums';
import { numericTransformer } from '../transformers';
import { App } from './app.entity';
import { Customer } from './customer.entity';
import { Subscription } from './subscription.entity';
import { TransactionLog } from './transaction-log.entity';
import { WebhookEvent } from './webhook-event.entity';
import { displayCodeColumn } from '../../common/display-code';

@Entity('transactions')
@Unique('uq_tx_app_idem', ['appId', 'idempotencyKey'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable display code; assigned by the DB on insert (see common/display-code.ts). */
  @Column(displayCodeColumn('transactions'))
  code!: string;

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

  // ─── Marketplace split (Slice 6) — null on non-marketplace payments ───────

  /** Merchant the payment was collected for; money lands in their sub-account. */
  @Index()
  @Column({ name: 'merchant_id', type: 'uuid', nullable: true })
  merchantId?: string | null;

  /** Xendit sub-account the payment was created on (`for-user-id`). Needed to
   *  read or refund the payment later — it isn't visible from the master. */
  @Column({ name: 'provider_account_id', type: 'varchar', length: 64, nullable: true })
  providerAccountId?: string | null;

  @Column({
    name: 'platform_fee_percent', type: 'numeric', precision: 5, scale: 2, nullable: true,
    transformer: numericTransformer,
  })
  platformFeePercent?: number | null;

  /** Platform's cut, minor units. Expected at creation; corrected by the split webhook. */
  @Column({ name: 'platform_fee_amount', type: 'int', nullable: true })
  platformFeeAmount?: number | null;

  /** amount − platformFeeAmount, before Xendit's own fees. Minor units. */
  @Column({ name: 'merchant_amount', type: 'int', nullable: true })
  merchantAmount?: number | null;

  @Column({ name: 'split_rule_id', type: 'varchar', length: 100, nullable: true })
  splitRuleId?: string | null;

  /** pending → completed | failed, from Xendit's split.payment webhook. */
  @Column({ name: 'split_status', type: 'varchar', length: 16, nullable: true })
  splitStatus?: string | null;

  @Column({ type: 'enum', enum: Source, nullable: true })
  source?: Source | null;

  @Column({ name: 'redirect_success', type: 'varchar', length: 500, nullable: true })
  redirectSuccess?: string | null;

  @Column({ name: 'redirect_failed', type: 'varchar', length: 500, nullable: true })
  redirectFailed?: string | null;

  @Column({ name: 'checkout_url', type: 'varchar', length: 500, nullable: true })
  checkoutUrl?: string | null;

  /** How it was paid (Xendit channel: QRPH, GCASH, CREDIT_CARD, …); set when it succeeds. */
  @Column({ name: 'payment_channel', type: 'varchar', length: 40, nullable: true })
  paymentChannel?: string | null;

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
