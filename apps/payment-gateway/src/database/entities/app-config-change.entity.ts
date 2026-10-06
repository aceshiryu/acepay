import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { App } from './app.entity';

/**
 * Audit trail of an app's marketplace settings — every change, whether the
 * operator made it in the admin or the app made it with its API key. Shown in
 * the admin so a surprising change (e.g. from a leaked key) can be spotted and
 * reverted.
 */
@Entity('app_config_changes')
export class AppConfigChange {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  /** 'admin' (operator in the AcePay admin) or 'app' (the app's API key). */
  @Column({ length: 16 })
  actor!: 'admin' | 'app';

  /** Admin email, or the API key prefix (never the key itself). */
  @Column({ name: 'actor_ref', type: 'varchar', length: 320, nullable: true })
  actorRef?: string | null;

  /** e.g. marketplace_fee_percent, marketplace_min_payout */
  @Column({ length: 64 })
  field!: string;

  @Column({ name: 'old_value', type: 'jsonb', nullable: true })
  oldValue?: unknown;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue?: unknown;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
