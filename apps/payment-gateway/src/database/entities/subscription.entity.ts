import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { Provider, SubscriptionStatus } from '../../common/enums';
import { App } from './app.entity';
import { Customer } from './customer.entity';
import { Plan } from './plan.entity';
import { Transaction } from './transaction.entity';
import { displayCodeColumn } from '../../common/display-code';

@Entity('subscriptions')
// Same shape as uq_tx_app_idem on transactions: a retry of the same create call
// from the same app must not produce a second subscription and a second checkout.
@Unique('uq_sub_app_idem', ['appId', 'idempotencyKey'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable display code; assigned by the DB on insert (see common/display-code.ts). */
  @Column(displayCodeColumn('subscriptions'))
  code!: string;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, (a) => a.subscriptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  /** Caller-supplied retry key. Null for callers that do not send one. */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 200, nullable: true })
  idempotencyKey?: string | null;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => Customer, (c) => c.subscriptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @ManyToOne(() => Plan, (p) => p.subscriptions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan?: Plan;

  @Column({ type: 'enum', enum: Provider })
  provider!: Provider;

  @Index({ unique: true })
  @Column({ name: 'provider_subscription_id', length: 200 })
  providerSubscriptionId!: string;

  @Index()
  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.Active })
  status!: SubscriptionStatus;

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart?: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd?: Date | null;

  @Column({ name: 'cancel_at', type: 'timestamptz', nullable: true })
  cancelAt?: Date | null;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt?: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Transaction, (t) => t.subscription)
  transactions?: Transaction[];
}
