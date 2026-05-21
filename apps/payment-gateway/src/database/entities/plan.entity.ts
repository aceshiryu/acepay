import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { PlanInterval, Provider } from '../../common/enums';
import { App } from './app.entity';
import { Subscription } from './subscription.entity';

@Entity('plans')
@Unique('uq_plans_app_slug', ['appId', 'slug'])
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, (a) => a.plans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  @Column({ length: 200 })
  name!: string;

  @Column({ length: 200 })
  slug!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country?: string | null;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ length: 8 })
  currency!: string;

  @Column({ type: 'enum', enum: PlanInterval })
  interval!: PlanInterval;

  @Column({ name: 'interval_count', type: 'int', default: 1 })
  intervalCount!: number;

  @Column({ type: 'enum', enum: Provider })
  provider!: Provider;

  @Column({ name: 'provider_plan_id', length: 200 })
  providerPlanId!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Subscription, (s) => s.plan)
  subscriptions?: Subscription[];
}
