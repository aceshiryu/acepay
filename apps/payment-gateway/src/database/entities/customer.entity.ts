import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { XenditPaymentMethodStatus } from '../../common/enums';
import { App } from './app.entity';
import { Subscription } from './subscription.entity';
import { Transaction } from './transaction.entity';

@Entity('customers')
@Unique('uq_customers_app_email', ['appId', 'email'])
@Unique('uq_customers_app_external', ['appId', 'externalId'])
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, (a) => a.customers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  @Column({ name: 'external_id', length: 200 })
  externalId!: string;

  @Column({ length: 320 })
  email!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name?: string | null;

  @Column({ name: 'lemonsqueezy_customer_id', type: 'varchar', length: 80, nullable: true })
  lemonsqueezyCustomerId?: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country?: string | null;

  @Column({ name: 'xendit_customer_id', type: 'varchar', length: 80, nullable: true })
  xenditCustomerId?: string | null;

  @Column({ name: 'xendit_payment_method_id', type: 'varchar', length: 80, nullable: true })
  xenditPaymentMethodId?: string | null;

  @Column({ name: 'xendit_payment_method_status', type: 'enum', enum: XenditPaymentMethodStatus, nullable: true })
  xenditPaymentMethodStatus?: XenditPaymentMethodStatus | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Subscription, (s) => s.customer)
  subscriptions?: Subscription[];

  @OneToMany(() => Transaction, (t) => t.customer)
  transactions?: Transaction[];
}
