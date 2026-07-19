import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { AdaptersModule } from '../adapters/adapters.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChannelHealthService } from './channel-health.service';

@Module({
  imports: [ActivityModule, AdaptersModule, RealtimeModule],
  providers: [ChannelsService, ChannelHealthService],
  controllers: [ChannelsController],
  exports: [ChannelsService, ChannelHealthService],
})
export class ChannelsModule {}
