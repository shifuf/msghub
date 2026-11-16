import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, ChangePasswordDto, TotpSetupDto, TotpCodeDto, TotpDisableDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ok } from '../common/utils';

@Controller('admin/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return ok(await this.auth.login(dto.username, dto.password, dto.code));
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

  @UseGuards(JwtAuthGuard)
  @Post('revoke-sessions')
  async revoke(@Request() req: any) { return ok(await this.auth.revokeSessions(req.user.id)); }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('totp/setup')
  async setup(@Request() req: any, @Body() dto: TotpSetupDto) { return ok(await this.auth.setupTotp(req.user.id, dto.password, req.user.tokenVersion)); }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('totp/enable')
  async enable(@Request() req: any, @Body() dto: TotpCodeDto) { return ok(await this.auth.enableTotp(req.user.id, dto.code, req.user.tokenVersion)); }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('totp/disable')
  async disable(@Request() req: any, @Body() dto: TotpDisableDto) { return ok(await this.auth.disableTotp(req.user.id, dto.password, dto.code, req.user.tokenVersion)); }
}
