import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { MerchantStatus } from '../../common/enums';
import { numericTransformer } from '../transformers';
import { App } from './app.entity';
import { displayCodeColumn } from '../../common/display-code';

/**
 * Someone an app collects money FOR — e.g. a BooklyPH coach. Each merchant has
 * its own Xendit (Owned) sub-account: booking payments are created on that
 * sub-account, the platform fee is split off to the master account, and the
 * rest stays there until a payout run sends it to the merchant's GCash / bank.
 *
 * One merchant per (app, person): the same coach on two apps is two merchants
 * with two sub-accounts, so balances, fees and refunds never mix across apps.
 */
@Entity('merchants')
@Unique('uq_merchants_app_external_ref', ['appId', 'externalRef'])
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable display code; assigned by the DB on insert (see common/display-code.ts). */
  @Column(displayCodeColumn('merchants'))
  code!: string;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  /** The app's own id for this merchant (e.g. BooklyPH's coach id). Unique per app. */
  @Column({ name: 'external_ref', length: 200 })
  externalRef!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ length: 320 })
  email!: string;

  @Index()
  @Column({ type: 'enum', enum: MerchantStatus, default: MerchantStatus.Pending })
  status!: MerchantStatus;

  /** Xendit Business ID of the sub-account — sent as `for-user-id`. */
  @Index({ unique: true, where: '"xendit_account_id" IS NOT NULL' })
  @Column({ name: 'xendit_account_id', type: 'varchar', length: 64, nullable: true })
  xenditAccountId?: string | null;

  /** Raw Xendit account status (LIVE, SUSPENDED, …) for display. */
  @Column({ name: 'xendit_account_status', type: 'varchar', length: 32, nullable: true })
  xenditAccountStatus?: string | null;

  /** Overrides the app's marketplace fee while `feeOverrideEndsAt` is in the
   *  future (or forever when it's null) — e.g. a 10% founding-coach rate. */
  @Column({
    name: 'fee_override_percent', type: 'numeric', precision: 5, scale: 2, nullable: true,
    transformer: numericTransformer,
  })
  feeOverridePercent?: number | null;

  @Column({ name: 'fee_override_ends_at', type: 'timestamptz', nullable: true })
  feeOverrideEndsAt?: Date | null;

  /** Xendit payout channel code, e.g. PH_GCASH, PH_BPI. */
  @Column({ name: 'payout_channel_code', type: 'varchar', length: 64, nullable: true })
  payoutChannelCode?: string | null;

  @Column({ name: 'payout_account_number', type: 'varchar', length: 100, nullable: true })
  payoutAccountNumber?: string | null;

  @Column({ name: 'payout_account_holder_name', type: 'varchar', length: 200, nullable: true })
  payoutAccountHolderName?: string | null;

  /** sha256 of channel + account number — finds the same destination on
   *  other merchants without comparing raw account numbers. */
  @Index()
  @Column({ name: 'payout_destination_hash', type: 'varchar', length: 64, nullable: true })
  payoutDestinationHash?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
