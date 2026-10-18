import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, IsString, IsUrl, Length, Max, Min } from 'class-validator';

export class TestPaymentDto {
  @ApiProperty({ example: 10000, description: 'Amount in centavos (₱100 = 10000)' })
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  amount!: number;

  @ApiPropertyOptional({ example: 'Test payment' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiProperty({ description: 'Where the checkout sends the customer back to (the admin page).' })
  @IsUrl({ require_tld: false })
  redirect!: string;
}
