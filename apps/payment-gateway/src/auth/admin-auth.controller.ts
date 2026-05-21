import {
  Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '../database/entities';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';

interface UserView {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const toUserView = (u: User): UserView => ({
  id: u.id,
  email: u.email,
  name: u.name ?? null,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt ?? null,
  createdAt: u.createdAt,
});

@ApiTags('admin/auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email + password, receive a Bearer token' })
  async login(@Body() dto: LoginDto) {
    const { token, user } = await this.auth.login(dto.email, dto.password);
    return { token, user: toUserView(user) };
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @ApiBearerAuth('admin')
  @ApiOperation({ summary: 'Return the currently authenticated admin user' })
  me(@CurrentUser() user: User) {
    return toUserView(user);
  }
}
