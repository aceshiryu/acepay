import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Small key → JSON store for operator-wide settings that aren't per-app,
 * e.g. `marketplace_defaults` (what a newly registered app starts with).
 */
@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryColumn({ length: 64 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @Column({ name: 'updated_by', type: 'varchar', length: 320, nullable: true })
  updatedBy?: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
