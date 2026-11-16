import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { resolveJwtSecret } from '../common/env';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(config),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub?: string; ver?: number; aud?: unknown }) {
    if (typeof payload.sub !== 'string' || !payload.sub || !Number.isInteger(payload.ver) || payload.aud !== undefined) {
      throw new UnauthorizedException('会话无效，请重新登录');
    }
    const user = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!user || user.tokenVersion !== payload.ver) throw new UnauthorizedException('会话已撤销');
    return { id: user.id, username: user.username, tokenVersion: user.tokenVersion };
  }
}
