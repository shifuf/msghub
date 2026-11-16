import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { generateTotpSecret, verifyTotp } from './totp.util';
import { openTotp, sealTotp } from './totp-storage.util';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(username: string, password: string, code?: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw new UnauthorizedException('用户名或密码错误');
    if (user.totpEnabled) await this.consumeTotp(user, code);

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      ver: user.tokenVersion,
    });

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_EXPIRES_IN') || '7d',
      user: { id: user.id, username: user.username },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: { id: true, username: true, lastLoginAt: true, createdAt: true, totpEnabled: true },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    return user;
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    const match = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!match) throw new UnauthorizedException('原密码错误');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    return { changed: true };
  }

  async revokeSessions(userId: string) {
    await this.prisma.adminUser.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    return { revoked: true };
  }

  private async consumeTotp(user: any, code?: string) {
    let counter: number | null = null;
    try { if (user.totpSecret) counter = verifyTotp(openTotp(user.totpSecret, this.config, `${user.id}:active`), code || ''); }
    catch { throw new UnauthorizedException('双因素配置无效，请联系管理员恢复'); }
    if (counter === null) throw new UnauthorizedException('需要有效的双因素验证码');
    const consumed = await this.prisma.adminUser.updateMany({
      where: { id: user.id, tokenVersion: user.tokenVersion, totpSecret: user.totpSecret, totpEnabled: true,
        OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: BigInt(counter) } }] },
      data: { totpLastCounter: BigInt(counter) },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('验证码已使用，请等待下一组验证码');
  }

  async setupTotp(userId: string, password: string, sessionVersion?: number) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    this.requireCurrentSession(user, sessionVersion);
    if (!user || !await bcrypt.compare(password, user.passwordHash)) throw new UnauthorizedException('密码错误');
    if (user.totpEnabled) throw new BadRequestException('双因素认证已启用');
    const secret = generateTotpSecret();
    const result = await this.prisma.adminUser.updateMany({ where: { id: userId, tokenVersion: user.tokenVersion, passwordHash: user.passwordHash, totpEnabled: false, totpPendingSecret: user.totpPendingSecret }, data: { totpPendingSecret: sealTotp(secret, this.config, `${userId}:pending`, Date.now() + 10 * 60000) } });
    if (result.count !== 1) throw new BadRequestException('配置已变更，请重新配置');
    return { secret, uri: `otpauth://totp/MsgHub:${encodeURIComponent(user.username)}?secret=${secret}&issuer=MsgHub&algorithm=SHA1&digits=6&period=30` };
  }

  async enableTotp(userId: string, code: string, sessionVersion?: number) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    this.requireCurrentSession(user, sessionVersion);
    let secret = '';
    try { if (user?.totpPendingSecret) secret = openTotp(user.totpPendingSecret, this.config, `${userId}:pending`); }
    catch { throw new BadRequestException('配置无效或已过期，请重新配置'); }
    const counter = secret ? verifyTotp(secret, code) : null;
    if (!user || user.totpEnabled || counter === null) throw new BadRequestException('请先配置并输入有效验证码');
    const result = await this.prisma.adminUser.updateMany({
      where: { id: userId, tokenVersion: user.tokenVersion, totpEnabled: false, totpPendingSecret: user.totpPendingSecret },
      data: { totpEnabled: true, totpSecret: sealTotp(secret, this.config, `${userId}:active`), totpPendingSecret: null, totpLastCounter: BigInt(counter), tokenVersion: { increment: 1 } },
    });
    if (result.count !== 1) throw new BadRequestException('配置已变更，请重新配置');
    return { enabled: true, reauthenticate: true };
  }

  async disableTotp(userId: string, password: string, code: string, sessionVersion?: number) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    this.requireCurrentSession(user, sessionVersion);
    if (!user || !await bcrypt.compare(password, user.passwordHash)) throw new UnauthorizedException('密码错误');
    if (!user.totpEnabled) throw new BadRequestException('双因素认证未启用');
    await this.consumeTotp(user, code);
    const result = await this.prisma.adminUser.updateMany({ where: { id: userId, tokenVersion: user.tokenVersion, totpSecret: user.totpSecret, totpEnabled: true }, data: { totpEnabled: false, totpSecret: null, totpPendingSecret: null, totpLastCounter: null, tokenVersion: { increment: 1 } } });
    if (result.count !== 1) throw new BadRequestException('配置已变更，请重新登录');
    return { enabled: false, reauthenticate: true };
  }

  private requireCurrentSession(user: any, sessionVersion?: number) {
    if (!user || !Number.isInteger(sessionVersion) || user.tokenVersion !== sessionVersion) throw new UnauthorizedException('会话已撤销');
  }
}
