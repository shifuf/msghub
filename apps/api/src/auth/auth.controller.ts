import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, ChangePasswordDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ok } from '../common/utils';

@Controller('admin/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return ok(await this.auth.login(dto.username, dto.password));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Request() req: any) {
    return ok(await this.auth.me(req.user.id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return ok(await this.auth.changePassword(req.user.id, dto.oldPassword, dto.newPassword));
  }
}
