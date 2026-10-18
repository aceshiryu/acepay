import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsString } from 'class-validator';
import { HIDEABLE_MENUS } from '../app-preferences.service';

export class UpdateAppMenusDto {
  @ApiProperty({
    type: [String], enum: HIDEABLE_MENUS, example: ['plans', 'invoices'],
    description: 'Menu items to hide for this app. Send [] to show everything.',
  })
  @IsArray()
  @ArrayMaxSize(HIDEABLE_MENUS.length)
  @IsString({ each: true })
  @IsIn(HIDEABLE_MENUS as unknown as string[], { each: true, message: 'unknown menu item' })
  hiddenMenus!: string[];
}
