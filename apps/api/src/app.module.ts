import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { ChannelsModule } from './channels/channels.module';
import { TemplatesModule } from './templates/templates.module';
import { PushTemplatesModule } from './push-templates/push-templates.module';
import { MessagesModule } from './messages/messages.module';
import { OpenApiModule } from './openapi/openapi.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AdaptersModule } from './adapters/adapters.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SchedulesModule } from './schedules/schedules.module';
import { BackupModule } from './backup/backup.module';
import { ActivityModule } from './activity/activity.module';
import { EmailPolicyModule } from './email-policy/email-policy.module';
import { EventsModule } from './events/events.module';
import { SiteModule } from './site/site.module';
import { resolveThrottle, validateSecurityEnvironment } from './common/env';
import { RedisThrottleModule, RedisThrottleStorage } from './common/redis-throttle.storage';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'], validate: validateSecurityEnvironment }),
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottleModule],
      inject: [RedisThrottleStorage],
      useFactory: (storage: RedisThrottleStorage) => ({ throttlers: [resolveThrottle()], storage }),
    }),
    PrismaModule,
    QueueModule.register(),
    AdaptersModule,
    RealtimeModule,
    AuthModule,
    ProjectsModule,
    ChannelsModule,
    TemplatesModule,
    PushTemplatesModule,
    MessagesModule,
    OpenApiModule,
    DashboardModule,
    HealthModule,
    SchedulesModule,
    BackupModule,
    ActivityModule,
    EmailPolicyModule,
    EventsModule,
    SiteModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
