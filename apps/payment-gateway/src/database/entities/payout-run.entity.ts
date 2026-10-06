import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { PayoutRunStatus } from '../../common/enums';
import { App } from './app.entity';
import { displayCodeColumn } from '../../common/display-code';

export interface ExcludedMerchant {
  merchantId: string;
  merchantName: string;
  appId: string;
  /** Live sub-account balance at build time, minor units (null if unreadable). */
  balance: number | null;
  reason:
    | 'paused' | 'no_payout_destination' | 'below_minimum' | 'balance_error'
    | 'no_sub_account' | 'payout_in_progress';
  detail?: string;
}

/**
 * One operator click: "pay every merchant what they're owed". Built in the
 * background (one live balance read per merchant), previewed, then confirmed —
 * nothing is sent until confirm. Only one run may be open at a time.
 */
@Entity('payout_runs')
export class PayoutRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable display code; assigned by the DB on insert (see common/display-code.ts). */
  @Column(displayCodeColumn('payout_runs'))
  code!: string;

  /** Optional filter: only this app's merchants. Null = every marketplace app. */
  @Index()
  @Column({ name: 'app_id', type: 'uuid', nullable: true })
  appId?: string | null;

  @ManyToOne(() => App, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'app_id' })
  app?: App | null;

  @Index()
  @Column({ type: 'enum', enum: PayoutRunStatus, default: PayoutRunStatus.Building })
  status!: PayoutRunStatus;

  @Column({ length: 8, default: 'PHP' })
  currency!: string;

  /** Sum of the run's non-skipped payouts, minor units. */
  @Column({ name: 'total_amount', type: 'int', default: 0 })
  totalAmount!: number;

  @Column({ name: 'payout_count', type: 'int', default: 0 })
  payoutCount!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  excluded!: ExcludedMerchant[];

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  errorMessage?: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 320, nullable: true })
  createdBy?: string | null;

  @Column({ name: 'built_at', type: 'timestamptz', nullable: true })
  builtAt?: Date | null;

  @Column({ name: 'confirmed_by', type: 'varchar', length: 320, nullable: true })
  confirmedBy?: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt?: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
