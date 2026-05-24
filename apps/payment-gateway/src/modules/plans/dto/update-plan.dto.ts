import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Min,
} from 'class-validator';
import { PlanInterval, PlanRegion } from '../../../common/enums';

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @ApiPropertyOptional({ enum: PlanRegion })
  @IsOptional()
  @IsEnum(PlanRegion)
  region?: PlanRegion;

  // Price / interval fields are only honored for Xendit plans.
  // For Lemon Squeezy plans the variant is source of truth — use Verify to sync.
  @ApiPropertyOptional({ description: 'Minor units (cents). Xendit plans only.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Xendit plans only.' })
  @IsOptional()
  @IsString()
  @Length(3, 8)
  currency?: string;

  @ApiPropertyOptional({ enum: PlanInterval, description: 'Xendit plans only.' })
  @IsOptional()
  @IsEnum(PlanInterval)
  interval?: PlanInterval;

  @ApiPropertyOptional({ description: 'Xendit plans only.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
