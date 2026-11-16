import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { configureBodyParsers } from './common/body-parser';
import { JwtService } from '@nestjs/jwt';
import { JwtStrategy } from './auth/jwt.strategy';
import {
  resolveAppEnv,
  resolveCorsOrigin,
  resolvePort,
  resolveSiteUrl,
  resolveTrustProxy,
} from './common/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureBodyParsers(app.getHttpAdapter().getInstance(), async req => {
    const match = /^Bearer (\S+)$/i.exec(String(req.headers.authorization || ''));
    if (!match) throw new Error('Missing token');
    const payload = await app.get(JwtService).verifyAsync(match[1], { algorithms: ['HS256'] });
    await app.get(JwtStrategy).validate(payload);
  });
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set('trust proxy', resolveTrustProxy());

  app.enableCors({
    origin: resolveCorsOrigin(),
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = resolvePort();
  await app.listen(port);
  const env = resolveAppEnv();
  const site = resolveSiteUrl() || '(auto / relative)';
  console.log(`[msghub] env=${env} port=${port} site=${site}`);
  console.log(`API listening on http://localhost:${port}`);
}

bootstrap();
