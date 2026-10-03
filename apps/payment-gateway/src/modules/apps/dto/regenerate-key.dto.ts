import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RegenerateKeyDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 168,
    description:
      'Keep the OUTGOING key valid for this many hours so a running app does not break '
      + 'mid-rotation. Omit it to revoke the old key immediately, which is what you want '
      + 'when rotating because the key may have leaked.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  graceHours?: number;
}
