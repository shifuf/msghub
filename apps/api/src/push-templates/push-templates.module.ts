import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { PushTemplatesService } from './push-templates.service';
import { PushTemplatesController } from './push-templates.controller';

@Module({
  imports: [ActivityModule],
  providers: [PushTemplatesService],
  controllers: [PushTemplatesController],
  exports: [PushTemplatesService],
})
export class PushTemplatesModule {}
