import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { TemplateVersionsService } from './template-versions.service';

@Module({
  imports: [ActivityModule],
  providers: [TemplatesService, TemplateVersionsService],
  controllers: [TemplatesController],
  exports: [TemplatesService, TemplateVersionsService],
})
export class TemplatesModule {}
