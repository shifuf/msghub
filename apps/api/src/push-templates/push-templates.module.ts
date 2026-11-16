import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { PushTemplatesService } from './push-templates.service';
import { PushTemplatesController } from './push-templates.controller';
import { TemplateVersionsService } from '../templates/template-versions.service';

@Module({
  imports: [ActivityModule],
  providers: [PushTemplatesService, TemplateVersionsService],
  controllers: [PushTemplatesController],
  exports: [PushTemplatesService],
})
export class PushTemplatesModule {}
