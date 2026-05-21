import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique,
} from 'typeorm';
import { Provider, WebhookDeliveryStatus } from '../../common/enums';
import { App } from './app.entity';
import { Transaction } from './transaction.entity';

@Entity('webhook_events')
@Unique('uq_webhook_provider_event', ['provider', 'providerEventId'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'app_id', type: 'uuid' })
  appId!: string;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: App;

  @Index()
  @Column({ name: 'transaction_id', type: 'uuid', nullable: true })
  transactionId?: string | null;

  @ManyToOne(() => Transaction, (t) => t.webhookEvents, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transaction_id' })
  transaction?: Transaction | null;

  @Column({ type: 'enum', enum: Provider })
  provider!: Provider;

  @Index()
  @Column({ name: 'event_type', length: 120 })
  eventType!: string;

  @Column({ name: 'provider_event_id', length: 200 })
  providerEventId!: string;

  @Column({ name: 'provider_payload', type: 'jsonb' })
  providerPayload!: Record<string, unknown>;

  @Column({ name: 'normalized_payload', type: 'jsonb', nullable: true })
  normalizedPayload?: Record<string, unknown> | null;

  @Index()
  @Column({
    name: 'delivery_status', type: 'enum', enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.Pending,
  })
  deliveryStatus!: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 5 })
  maxAttempts!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt?: Date | null;

  @Column({ name: 'first_attempt_at', type: 'timestamptz', nullable: true })
  firstAttemptAt?: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @Column({ name: 'last_attempt_at', type: 'timestamptz', nullable: true })
  lastAttemptAt?: Date | null;

  @Column({ name: 'last_response_status', type: 'int', nullable: true })
  lastResponseStatus?: number | null;

  @Column({ name: 'last_response_body', type: 'text', nullable: true })
  lastResponseBody?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
