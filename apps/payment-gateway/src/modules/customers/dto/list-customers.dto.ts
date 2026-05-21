import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListCustomersDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appId?: string;

  @ApiPropertyOptional({ description: 'Free-text search across name, email, external id' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joinedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joinedTo?: string;
}
