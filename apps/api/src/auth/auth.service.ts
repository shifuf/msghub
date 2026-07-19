import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw new UnauthorizedException('用户名或密码错误');

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
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
      select: { id: true, username: true, lastLoginAt: true, createdAt: true },
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
      data: { passwordHash },
    });
    return { changed: true };
  }
}
