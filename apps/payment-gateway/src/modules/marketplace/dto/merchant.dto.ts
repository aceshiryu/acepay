import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString,
  IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { MerchantStatus } from '../../../common/enums';

const CHANNEL_CODE_RE = /^[A-Z]{2}_[A-Z0-9_]+$/;

/** Payout destination fields shared by create + update. All-or-nothing. */
export class PayoutDestinationFields {
  @ApiPropertyOptional({ example: 'PH_GCASH', description: 'Xendit payout channel code (PH_GCASH, PH_PAYMAYA, PH_BPI, PH_BDO, …)' })
  @IsOptional()
  @IsString()
  @Matches(CHANNEL_CODE_RE, { message: 'payoutChannelCode must look like PH_GCASH' })
  payoutChannelCode?: string;

  @ApiPropertyOptional({ example: '09171234567' })
  @IsOptional()
  @IsString()
  @Length(4, 100)
  payoutAccountNumber?: string;

  @ApiPropertyOptional({ example: 'Juan Dela Cruz', description: 'Name on the bank / e-wallet account' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  payoutAccountHolderName?: string;
}

export class CreateMerchantDto extends PayoutDestinationFields {
  @ApiProperty({ example: 'coach_42', description: "Your own id for this merchant (e.g. BooklyPH's coach id). Unique within your app." })
  @IsString()
  @Length(1, 200)
  externalRef!: string;

  @ApiProperty({ example: 'Coach Juan Dela Cruz', description: 'Shown to customers on the Xendit checkout' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: 'juan@email.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** What the app may change. Fees and status are operator-only. */
export class UpdateMerchantAppDto extends PayoutDestinationFields {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateMerchantAdminDto extends UpdateMerchantAppDto {
  @ApiPropertyOptional({ enum: [MerchantStatus.Active, MerchantStatus.Paused], description: 'Pause / resume' })
  @IsOptional()
  @IsEnum(MerchantStatus)
  status?: MerchantStatus;

  @ApiPropertyOptional({
    example: 10, nullable: true,
    description: 'Fee override (e.g. founding-coach rate). null clears it.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feeOverridePercent?: number | null;

  @ApiPropertyOptional({ example: '2027-04-01T00:00:00Z', nullable: true, description: 'When the override ends; null = never' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  feeOverrideEndsAt?: string | null;
}

export class ListMerchantsAppDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Look up by your own id' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalRef?: string;

  @ApiPropertyOptional({ enum: MerchantStatus })
  @IsOptional()
  @IsEnum(MerchantStatus)
  status?: MerchantStatus;
}

export class ListMerchantsAdminDto extends ListMerchantsAppDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;

  @ApiPropertyOptional({ description: 'Name, email or external ref contains' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class MarketplaceSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ example: 12, description: 'Platform fee % for this app. Required to enable.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercent?: number | null;

  @ApiPropertyOptional({ example: 50000, description: 'Minimum payout, minor units (₱500 = 50000)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPayout?: number;

  @ApiPropertyOptional({
    example: 10, nullable: true,
    description: 'Lowest fee % the app may set for itself via PATCH /v1/app/config. Set with feeMaxPercent; both null = app cannot change its fee.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feeMinPercent?: number | null;

  @ApiPropertyOptional({ example: 15, nullable: true, description: 'Highest fee % the app may set for itself' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feeMaxPercent?: number | null;
}

/** What an app may change about itself with its own API key. */
export class UpdateAppConfigDto {
  @ApiPropertyOptional({
    example: 12,
    description: 'Default platform fee % for new payments. Must be inside the range the AcePay operator allowed.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercent?: number;

  @ApiPropertyOptional({ example: 50000, description: 'Minimum payout, minor units (₱500 = 50000). Up to ₱1,000,000.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  minPayout?: number;
}

export class ListConfigChangesDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;
}

export class ChannelsQueryDto {
  @ApiPropertyOptional({ default: 'PHP' })
  @IsOptional()
  @IsString()
  @Length(3, 8)
  currency?: string;
}
