import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  Provider, Source, TransactionStatus, TransactionType,
} from '../../../common/enums';

export class ListTransactionsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text search across id, customer, email, description' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;

  @ApiPropertyOptional({ enum: Provider })
  @IsOptional()
  @IsEnum(Provider)
  provider?: Provider;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ enum: Source })
  @IsOptional()
  @IsEnum(Source)
  source?: Source;

  @ApiPropertyOptional({ description: 'ISO date — created_at >= from' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date — created_at <= to' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;
}

export class RefundDto {
  @ApiPropertyOptional({ description: 'Optional partial-refund amount (smallest unit). Defaults to full amount.' })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
