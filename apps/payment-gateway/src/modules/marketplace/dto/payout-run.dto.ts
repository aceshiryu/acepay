import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PayoutRunStatus, PayoutStatus } from '../../../common/enums';

export class CreatePayoutRunDto {
  @ApiPropertyOptional({ description: "Only pay this app's merchants. Omit to include every marketplace app." })
  @IsOptional()
  @IsUUID()
  appId?: string;
}

export class ConfirmPayoutRunDto {
  @ApiPropertyOptional({ type: [String], description: 'Merchants unticked in the preview — they are skipped this run' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  skipMerchantIds?: string[];
}

export class ListPayoutRunsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PayoutRunStatus })
  @IsOptional()
  @IsEnum(PayoutRunStatus)
  status?: PayoutRunStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;
}

export class ListPayoutsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;
}
