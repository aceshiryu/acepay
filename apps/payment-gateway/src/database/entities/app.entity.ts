import {
  Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { BillingMode } from '../../common/enums';
import { numericTransformer } from '../transformers';
import { Customer } from './customer.entity';
import { Plan } from './plan.entity';
import { Subscription } from './subscription.entity';
import { Transaction } from './transaction.entity';
import { displayCodeColumn } from '../../common/display-code';

@Entity('apps')
export class App {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable display code; assigned by the DB on insert (see common/display-code.ts). */
  @Column(displayCodeColumn('apps'))
  code!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ length: 80, unique: true })
  slug!: string;

  @Index()
  @Column({ name: 'api_key_prefix', length: 32 })
  apiKeyPrefix!: string;

  @Index({ unique: true })
  @Column({ name: 'api_key_hash', length: 64 })
  apiKeyHash!: string;

  // Optional expiry for the current key (null = never expires).
  @Column({ name: 'api_key_expires_at', type: 'timestamptz', nullable: true })
  apiKeyExpiresAt?: Date | null;

  // Rotation grace: the previous key keeps working until its own expiry so a
  // key rotation doesn't instantly break a running app.
  @Index()
  @Column({ name: 'api_key_previous_prefix', type: 'varchar', length: 32, nullable: true })
  apiKeyPreviousPrefix?: string | null;

  @Column({ name: 'api_key_previous_hash', type: 'varchar', length: 64, nullable: true })
  apiKeyPreviousHash?: string | null;

  @Column({ name: 'api_key_previous_expires_at', type: 'timestamptz', nullable: true })
  apiKeyPreviousExpiresAt?: Date | null;

  @Column({ name: 'webhook_url', type: 'varchar', length: 500, nullable: true })
  webhookUrl?: string | null;

  @Column({ name: 'webhook_secret_enc', type: 'text', nullable: true })
  webhookSecretEnc?: string | null;

  @Column({ name: 'required_metadata', type: 'text', array: true, default: '{}' })
  requiredMetadata!: string[];

  @Column({ name: 'optional_metadata', type: 'text', array: true, default: '{}' })
  optionalMetadata!: string[];

  @Column({ name: 'rate_limit', type: 'int', default: 100 })
  rateLimit!: number;

  @Column({ name: 'billing_mode', type: 'enum', enum: BillingMode, default: BillingMode.OneTime })
  billingMode!: BillingMode;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  // ─── Marketplace (Slice 6) ──────────────────────────────────────────────
  // Lets an app charge on behalf of its merchants (e.g. BooklyPH coaches) with
  // a platform fee split off at payment time. There is deliberately NO global
  // default fee: every marketplace app sets its own.

  @Column({ name: 'marketplace_enabled', type: 'boolean', default: false })
  marketplaceEnabled!: boolean;

  /** Platform fee for this app's bookings, e.g. 12 for BooklyPH. */
  @Column({
    name: 'marketplace_fee_percent', type: 'numeric', precision: 5, scale: 2, nullable: true,
    transformer: numericTransformer,
  })
  marketplaceFeePercent?: number | null;

  /** Range the APP may set its own fee within via PATCH /v1/app/config. Both
   *  null = the app can't change its fee at all (operator-only). Guards against
   *  a leaked API key zeroing the platform fee. */
  @Column({
    name: 'marketplace_fee_min_percent', type: 'numeric', precision: 5, scale: 2, nullable: true,
    transformer: numericTransformer,
  })
  marketplaceFeeMinPercent?: number | null;

  @Column({
    name: 'marketplace_fee_max_percent', type: 'numeric', precision: 5, scale: 2, nullable: true,
    transformer: numericTransformer,
  })
  marketplaceFeeMaxPercent?: number | null;

  /** Merchants whose payable balance is below this roll over to the next run. Minor units. */
  @Column({ name: 'marketplace_min_payout', type: 'int', default: 50000 })
  marketplaceMinPayout!: number;

  /**
   * The payment methods this app's checkouts offer (Xendit codes, e.g. GCASH,
   * QRPH). NULL = every method the Xendit account has switched on. Sent with
   * each checkout, because Xendit's dashboard setting does not reach the
   * sub-accounts marketplace payments go through.
   */
  @Column({ name: 'payment_methods', type: 'text', array: true, nullable: true })
  paymentMethods?: string[] | null;

  // ─── Setup checks ────────────────────────────────────────────────────────
  /** The last "Send test webhook": when, whether the app answered 2xx, and what happened. */
  @Column({ name: 'last_ping_at', type: 'timestamptz', nullable: true })
  lastPingAt?: Date | null;

  @Column({ name: 'last_ping_ok', type: 'boolean', nullable: true })
  lastPingOk?: boolean | null;

  @Column({ name: 'last_ping_detail', type: 'varchar', length: 300, nullable: true })
  lastPingDetail?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Customer, (c) => c.app)
  customers?: Customer[];

  @OneToMany(() => Plan, (p) => p.app)
  plans?: Plan[];

  @OneToMany(() => Subscription, (s) => s.app)
  subscriptions?: Subscription[];

  @OneToMany(() => Transaction, (t) => t.app)
  transactions?: Transaction[];
}
