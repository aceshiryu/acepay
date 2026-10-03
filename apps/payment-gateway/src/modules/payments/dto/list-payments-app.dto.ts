import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Provider, Source, TransactionStatus, TransactionType } from '../../../common/enums';

export class ListPaymentsAppDto extends PaginationDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class RefundPaymentDto {
  // Must be a positive whole number of minor units. Without @IsInt/@Min the
  // pipe's implicit conversion turns "abc" into NaN and lets a negative amount
  // through — the service's only check is an upper bound, so both reached the
  // provider and wrote a bogus ledger row.
  @ApiPropertyOptional({
    minimum: 1,
    description: 'Optional partial-refund amount in smallest unit. Defaults to full amount.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
