import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { LogActor } from '../../../common/enums';

export class ListActivityLogsDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  transactionId?: string;

  @ApiPropertyOptional({ enum: LogActor })
  @IsOptional()
  @IsEnum(LogActor)
  actor?: LogActor;

  @ApiPropertyOptional({ description: 'Match actions by prefix, e.g. "payment." or "subscription."' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  actionPrefix?: string;

  @ApiPropertyOptional({ description: 'Free-text search across action and provider event id' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
