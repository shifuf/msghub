import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminDevicesController, PublicDevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({ imports: [ActivityModule, RealtimeModule], controllers: [AdminDevicesController, PublicDevicesController], providers: [DevicesService], exports: [DevicesService] })
export class DevicesModule {}
