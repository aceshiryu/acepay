import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * A provider credential saved from the admin Integrations page. Overrides the
 * env var of the same name (`key`). `valueEnc` is AES-256-GCM via
 * `encryptSecret`, for every value — not only the secret ones — so a database
 * dump never shows which store/account the keys belong to either.
 */
@Entity('provider_credentials')
export class ProviderCredential {
  /** The env var name it overrides, e.g. `XENDIT_SECRET_KEY`. */
  @PrimaryColumn({ length: 64 })
  key!: string;

  @Column({ length: 32 })
  provider!: string;

  @Column({ name: 'value_enc', type: 'text' })
  valueEnc!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 320, nullable: true })
  updatedBy?: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
