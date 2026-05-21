import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min,
} from 'class-validator';
import { PlanInterval, Provider } from '../../../common/enums';

export class CreatePlanDto {
  @ApiProperty({ description: 'AcePay app id this plan belongs to' })
  @IsUUID()
  appId!: string;

  @ApiProperty({ example: 'Pro Monthly' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: 'pro-monthly', description: 'Stable identifier apps reference (unique per app)' })
  @IsString()
  @Length(1, 200)
  slug!: string;

  @ApiProperty({ example: 29900, description: 'Amount in smallest currency unit (e.g. centavos)' })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: 'PHP' })
  @IsString()
  @Length(3, 8)
  currency!: string;

  @ApiProperty({ enum: PlanInterval, example: PlanInterval.Monthly })
  @IsEnum(PlanInterval)
  interval!: PlanInterval;

  @ApiPropertyOptional({ default: 1, description: 'Bills every N intervals' })
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalCount?: number;

  @ApiProperty({ enum: Provider, example: Provider.Lemonsqueezy })
  @IsEnum(Provider)
  provider!: Provider;

  @ApiPropertyOptional({
    description:
      "Provider's plan id. For Lemon Squeezy this is the Variant ID (required). " +
      "For Xendit, omit this — AcePay synthesizes a value since Xendit has no plan resource.",
    example: '987654',
  })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  providerPlanId!: string;

  @ApiPropertyOptional({ description: 'Operator-facing description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'PH', description: 'ISO-2 country code; null = worldwide' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
