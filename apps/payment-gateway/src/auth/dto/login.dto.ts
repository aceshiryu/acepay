import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'acecerio1@gmail.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '••••••••', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
