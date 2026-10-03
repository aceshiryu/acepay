import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique,
} from 'typeorm';
import { numericTransformer } from '../transformers';

/**
 * Cache of Xendit split rules, one per distinct fee rate. A rule only says
 * "route <percent>% to the platform account", so every app and merchant on
 * that rate shares it — BooklyPH's 12% and 10% founding rate are two rules,
 * not one per coach.
 */
@Entity('xendit_split_rules')
@Unique('uq_xendit_split_rules_rate', ['percent', 'currency', 'destinationAccountId'])
export class XenditSplitRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: numericTransformer })
  percent!: number;

  @Column({ length: 8 })
  currency!: string;

  /** Xendit Business ID the fee is routed to (the platform / master account). */
  @Column({ name: 'destination_account_id', length: 64 })
  destinationAccountId!: string;

  @Column({ name: 'xendit_split_rule_id', length: 100 })
  xenditSplitRuleId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
