import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
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
  @ApiPropertyOptional({ description: 'Optional partial-refund amount in smallest unit. Defaults to full amount.' })
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  reason?: string;
}
