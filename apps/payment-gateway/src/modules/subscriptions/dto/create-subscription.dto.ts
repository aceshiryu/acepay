import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsObject, IsOptional, IsUrl, IsUUID, ValidateNested,
} from 'class-validator';

export class RedirectDto {
  @ApiProperty({ example: 'https://savi.app/payment/success?tx=…' })
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https', 'saviapp', 'courthubapp', 'vehikolapp'] })
  success!: string;

  @ApiProperty({ example: 'https://savi.app/payment/failed?tx=…' })
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https', 'saviapp', 'courthubapp', 'vehikolapp'] })
  failed!: string;
}

export class CreateSubscriptionDto {
  @ApiProperty({ description: 'AcePay plan id (the plan must belong to the calling app and be active)' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ description: 'AcePay customer id (created via /v1/customers)' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ type: RedirectDto })
  @ValidateNested()
  @Type(() => RedirectDto)
  redirect!: RedirectDto;

  @ApiPropertyOptional({
    description: 'App-specific metadata stored on the subscription and echoed in webhooks.',
    example: { user_id: 'user_42', source: 'pricing-page' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({ description: 'Optional reason recorded in metadata' })
  @IsOptional()
  reason?: string;
}
