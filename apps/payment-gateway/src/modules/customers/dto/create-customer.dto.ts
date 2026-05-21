import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail, IsObject, IsOptional, IsString, MaxLength,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ description: 'The app\'s own user id (unique within the app)', example: 'user_42' })
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
