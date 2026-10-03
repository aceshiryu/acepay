import { ValueTransformer } from 'typeorm';

/** Postgres `numeric` comes back from the driver as a string (to avoid float
 *  precision loss). Fee percentages like 12.50 are small enough to be safe as
 *  JS numbers, so convert at the entity boundary. */
export const numericTransformer: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v == null ? null : Number(v)),
};
