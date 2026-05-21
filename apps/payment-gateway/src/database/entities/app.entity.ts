import {
  Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { BillingMode } from '../../common/enums';
import { Customer } from './customer.entity';
import { Plan } from './plan.entity';
import { Subscription } from './subscription.entity';
import { Transaction } from './transaction.entity';

@Entity('apps')
export class App {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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
