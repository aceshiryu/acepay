import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export type NotificationSeverity = 'critical' | 'warn' | 'info' | 'success';
const SEVERITIES: NotificationSeverity[] = ['critical', 'warn', 'info', 'success'];

export class ListNotificationsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsEnum(['critical', 'warn', 'info', 'success'])
  severity?: NotificationSeverity;
}
