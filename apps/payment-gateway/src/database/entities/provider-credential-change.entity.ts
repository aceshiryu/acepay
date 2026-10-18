import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Audit trail for the Integrations page: who set or cleared which credential.
 *  Never stores the value, old or new. */
@Entity('provider_credential_changes')
export class ProviderCredentialChange {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  key!: string;

  @Column({ length: 32 })
  provider!: string;

  /** `set` = saved in AcePay; `cleared` = removed, back to the .env value. */
  @Column({ length: 16 })
  action!: 'set' | 'cleared';

  @Column({ type: 'varchar', length: 320, nullable: true })
  actor?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
