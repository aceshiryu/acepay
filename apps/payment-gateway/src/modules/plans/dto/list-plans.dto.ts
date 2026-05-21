import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PlanInterval, Provider } from '../../../common/enums';

export class ListPlansDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;

  @ApiPropertyOptional({ enum: Provider })
  @IsOptional()
  @IsEnum(Provider)
  provider?: Provider;

  @ApiPropertyOptional({ enum: PlanInterval })
  @IsOptional()
  @IsEnum(PlanInterval)
  interval?: PlanInterval;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
