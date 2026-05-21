import { BadRequestException, Injectable } from '@nestjs/common';
import { App } from '../../database/entities';

@Injectable()
export class MetadataValidatorService {
  validate(app: App, metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    const md = metadata ?? {};
    const required = app.requiredMetadata ?? [];
    const missing = required.filter((k) => !(k in md) || md[k] == null || md[k] === '');
    if (missing.length > 0) {
      throw new BadRequestException({
        error: 'missing_required_metadata',
        missing,
        message: `${app.name} requires: ${required.join(', ')}`,
      });
    }
    return md;
  }
}
