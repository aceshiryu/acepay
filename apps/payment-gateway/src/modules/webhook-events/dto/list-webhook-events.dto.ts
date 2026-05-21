import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Provider, WebhookDeliveryStatus } from '../../../common/enums';

export class ListWebhookEventsDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;

  @ApiPropertyOptional({ enum: Provider })
  @IsOptional()
  @IsEnum(Provider)
  provider?: Provider;

  @ApiPropertyOptional({ enum: WebhookDeliveryStatus })
  @IsOptional()
  @IsEnum(WebhookDeliveryStatus)
  deliveryStatus?: WebhookDeliveryStatus;

  @ApiPropertyOptional({ description: 'Free-text search across event id, type, transaction id' })
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

export class WebhookStatsDto {
  @ApiPropertyOptional({ default: 24, minimum: 1, maximum: 720, description: 'Window for delivered count, in hours' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  windowHours?: number = 24;
}
