import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { RedirectDto } from '../../subscriptions/dto/create-subscription.dto';

export class PaymentCustomerDto {
  @ApiPropertyOptional({ example: 'student@email.com', description: 'Pre-fills the checkout and receives the receipt' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Maria Santos' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class CreateMarketplacePaymentDto {
  @ApiProperty({ example: 50000, description: 'Amount in the smallest unit (₱500 = 50000)' })
  @IsInt()
  @Min(100)
  amount!: number;

  @ApiProperty({ example: 'PHP', enum: ['PHP'] })
  @IsIn(['PHP'])
  currency!: string;

  @ApiProperty({ description: 'AcePay merchant id (must belong to your app and be active)' })
  @IsUUID()
  merchantId!: string;

  @ApiProperty({
    maxLength: 200, example: 'booking_9f2c',
    description: 'Retry key — use your booking id. The same key returns the SAME payment and checkout URL.',
  })
  @IsString()
  @Length(1, 200)
  idempotencyKey!: string;

  @ApiPropertyOptional({ example: 'Tennis session with Coach Juan — Oct 10, 4pm' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: RedirectDto })
  @ValidateNested()
  @Type(() => RedirectDto)
  redirect!: RedirectDto;

  @ApiPropertyOptional({ type: PaymentCustomerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentCustomerDto)
  customer?: PaymentCustomerDto;

  @ApiPropertyOptional({ example: { bookingId: 'booking_9f2c' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
