import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional,
  IsString, Length, Matches, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { BillingMode, PlanInterval, PlanRegion, Provider } from '../../../common/enums';
import { IsWebhookUrl } from '../../../common/validators/is-webhook-url';
import { ALL_PAYMENT_METHOD_CODES } from '../../../common/payment-methods';

export class InlinePlanDto {
  @ApiProperty({ enum: Provider, example: Provider.Lemonsqueezy })
  @IsEnum(Provider)
  provider!: Provider;

  @ApiProperty({ example: 'Pro Monthly' })
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiPropertyOptional({ example: 'Best for solo users' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    enum: PlanRegion,
    example: PlanRegion.International,
    description: '"local" routes to Xendit (Philippines). "international" routes to Lemon Squeezy.',
  })
  @IsEnum(PlanRegion)
  region!: PlanRegion;

  // ── Lemon Squeezy ────────────────────────────────────────────────────
  @ApiPropertyOptional({
    example: '987654',
    description: 'Required when provider=lemonsqueezy. Variant ID of a Subscription-priced LS variant.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  variantId?: string;

  // ── Xendit (AcePay-managed; no provider plan object) ─────────────────
  @ApiPropertyOptional({ example: 29900, description: 'Required when provider=xendit. Amount in smallest unit (centavos).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ example: 'PHP', description: 'Required when provider=xendit.' })
  @IsOptional()
  @IsString()
  @Length(3, 8)
  currency?: string;

  @ApiPropertyOptional({ enum: PlanInterval, example: PlanInterval.Monthly, description: 'Required when provider=xendit.' })
  @IsOptional()
  @IsEnum(PlanInterval)
  interval?: PlanInterval;

  @ApiPropertyOptional({ default: 1, description: 'Bills every N intervals. Defaults to 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalCount?: number;
}

export class CreateAppDto {
  @ApiProperty({ example: 'Savi', description: 'Display name shown across the dashboard' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: 'savi',
    description: 'URL-safe identifier. Auto-derived from name if omitted.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/, {
    message: 'slug must be lowercase alphanumeric with hyphens, 1–80 chars',
  })
  slug?: string;

  @ApiPropertyOptional({
    example: 'https://savi.app/webhooks/acepay',
    description: 'Endpoint AcePay POSTs normalized events to',
  })
  @IsOptional()
  @IsWebhookUrl()
  @MaxLength(500)
  webhookUrl?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['user_id', 'plan'],
    description: 'Metadata keys that every payment must include. Missing keys are rejected.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  requiredMetadata?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['promo_code', 'referrer'],
    description: 'Metadata keys that may optionally be included',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  optionalMetadata?: string[];

  @ApiPropertyOptional({ example: 100, description: 'Per-app rate limit (requests / minute)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimit?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    example: ['GCASH', 'PAYMAYA', 'GRABPAY', 'SHOPEEPAY', 'QRPH'],
    description:
      'The payment methods this app\'s checkouts offer (Xendit codes, see PAYMENT_METHOD_GROUPS). ' +
      'null or empty = every method the Xendit account has switched on.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALL_PAYMENT_METHOD_CODES.length)
  @ArrayUnique()
  @IsIn(ALL_PAYMENT_METHOD_CODES as string[], { each: true, message: 'unknown payment method code' })
  paymentMethods?: string[] | null;

  @ApiProperty({
    enum: BillingMode,
    example: BillingMode.OneTime,
    description: 'Apps are either subscription-based OR one-time-payment-based, not both',
  })
  @IsEnum(BillingMode)
  billingMode!: BillingMode;

  @ApiPropertyOptional({
    type: [InlinePlanDto],
    description: 'Optional. Register subscription plans inline (they can also be added later). ' +
      'Each Lemon Squeezy plan references a Subscription variant by ID.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => InlinePlanDto)
  plans?: InlinePlanDto[];
}
