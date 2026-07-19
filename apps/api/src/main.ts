import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import {
  resolveAppEnv,
  resolveCorsOrigin,
  resolvePort,
  resolveSiteUrl,
} from './common/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
