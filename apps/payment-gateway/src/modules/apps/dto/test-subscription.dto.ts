import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

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
}
