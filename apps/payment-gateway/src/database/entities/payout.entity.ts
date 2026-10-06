import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { PayoutStatus } from '../../common/enums';
import { App } from './app.entity';
import { Merchant } from './merchant.entity';
import { PayoutRun } from './payout-run.entity';
import { displayCodeColumn } from '../../common/display-code';

/**
 * One transfer from a merchant's sub-account to their GCash / bank. The
 * destination is SNAPSHOTTED from the merchant when the payout is queued, so
 * a merchant editing their details later never rewrites where money went.
 *
 * The AcePay id doubles as Xendit's `reference_id` and `Idempotency-key`: a
 * retried send can never pay twice, and a send whose response was lost can
 * still be found on Xendit by reference.
 */
@Entity('payouts')
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable display code; assigned by the DB on insert (see common/display-code.ts). */
  @Column(displayCodeColumn('payouts'))
  code!: string;

  @Index()
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null;

  @ManyToOne(() => PayoutRun, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'run_id' })
  run?: PayoutRun | null;

  @Index()
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @ManyToOne(() => Merchant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchant_id' })
  merchant?: Merchant;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  /** Smallest currency unit (centavos), like every other amount in AcePay. */
  @Column({ type: 'int' })
  amount!: number;

  @Column({ length: 8 })
  currency!: string;

  /** Sub-account balance when the run was built (minor units). */
  @Column({ name: 'balance_at_build', type: 'int', nullable: true })
  balanceAtBuild?: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null;

  @Index()
  @Column({ type: 'enum', enum: PayoutStatus, default: PayoutStatus.Draft })
  status!: PayoutStatus;

  @Column({ name: 'channel_code', type: 'varchar', length: 64, nullable: true })
  channelCode?: string | null;

  @Column({ name: 'account_number', type: 'varchar', length: 100, nullable: true })
  accountNumber?: string | null;

  @Column({ name: 'account_holder_name', type: 'varchar', length: 200, nullable: true })
  accountHolderName?: string | null;

  /** The merchant's sub-account the money leaves from (`for-user-id`). */
  @Column({ name: 'xendit_account_id', type: 'varchar', length: 64, nullable: true })
  xenditAccountId?: string | null;

  @Index({ unique: true, where: '"xendit_payout_id" IS NOT NULL' })
  @Column({ name: 'xendit_payout_id', type: 'varchar', length: 100, nullable: true })
  xenditPayoutId?: string | null;

  /** Raw Xendit status (REQUESTED / ACCEPTED / …) for display. */
  @Column({ name: 'provider_status', type: 'varchar', length: 32, nullable: true })
  providerStatus?: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode?: string | null;

  @Column({ name: 'failure_message', type: 'varchar', length: 500, nullable: true })
  failureMessage?: string | null;

  /** Set when this payout re-sends a failed one. */
  @Column({ name: 'retry_of', type: 'uuid', nullable: true })
  retryOf?: string | null;

  @Column({ name: 'estimated_arrival_at', type: 'timestamptz', nullable: true })
  estimatedArrivalAt?: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  raw!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
