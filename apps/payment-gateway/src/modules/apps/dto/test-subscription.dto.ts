import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class TestSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty()
  @IsEmail()
  customerEmail!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  customerName?: string;

  @ApiPropertyOptional({ description: 'URL the customer is redirected to after paying.' })
  @IsOptional()
  @IsString()
  redirect?: string;

  @ApiPropertyOptional({
    description: "Metadata to send. Any of the app's required keys left out are filled with a 'sandbox' placeholder, so a test run never fails the app's metadata contract.",
    example: { user_id: 'qa-user-1' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
