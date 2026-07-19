import { Module, Global, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AdaptersModule } from '../adapters/adapters.module';
import { ChannelsModule } from '../channels/channels.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EmailPolicyModule } from '../email-policy/email-policy.module';
import { SendProcessor } from './send.processor';
import { SEND_QUEUE } from './queue.constants';
import { QueueAdminService } from './queue-admin.service';
import { QueueAdminController } from './queue-admin.controller';
import { resolveRedis } from '../common/env';

@Global()
@Module({})
export class QueueModule {
  static register(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        ConfigModule,
        AdaptersModule,
        ChannelsModule,
        RealtimeModule,
        EmailPolicyModule,
        BullModule.forRootAsync({
          useFactory: () => {
            const redis = resolveRedis();
            return {
              connection: {
                host: redis.host,
                port: redis.port,
                password: redis.password,
                maxRetriesPerRequest: null,
              },
            };
          },
        }),
        BullModule.registerQueue({ name: SEND_QUEUE }),
      ],
      providers: [SendProcessor, QueueAdminService],
      controllers: [QueueAdminController],
      exports: [BullModule, QueueAdminService],
    };
  }
}
