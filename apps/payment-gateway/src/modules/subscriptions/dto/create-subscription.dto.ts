import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail, IsObject, IsOptional, IsString, IsUrl, IsUUID, MaxLength, ValidateNested,
} from 'class-validator';

export class RedirectDto {
  @ApiProperty({ example: 'https://savi.app/payment/success?tx=…' })
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https', 'saviapp', 'courthubapp', 'vehikolapp'] })
  success!: string;

  @ApiProperty({ example: 'https://savi.app/payment/failed?tx=…' })
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https', 'saviapp', 'courthubapp', 'vehikolapp'] })
  failed!: string;
}

export class InlineCustomerDto {
  @ApiProperty({ description: "The app's own user id (unique within the app)", example: 'user_42' })
  @IsString()
  @MaxLength(200)
  externalId!: string;

  @ApiProperty({ example: 'juan@email.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'Juan Dela Cruz' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateSubscriptionDto {
  @ApiProperty({ description: 'AcePay plan id (the plan must belong to the calling app and be active)' })
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({
    description: 'AcePay customer id (from a previous /v1/customers or /v1/subscriptions call). ' +
      'Pass this OR `customer` — not both.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    type: InlineCustomerDto,
    description: 'Create-or-reuse a customer inline. Pass this on the first subscription; ' +
      'AcePay matches by externalId or email and reuses if found.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineCustomerDto)
  customer?: InlineCustomerDto;

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
