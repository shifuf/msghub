import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController, MessagesExtraController } from './messages.controller';
import { PublicMessagesController } from './public-messages.controller';
import { AdaptersModule } from '../adapters/adapters.module';
import { ChannelsModule } from '../channels/channels.module';
import { TemplatesModule } from '../templates/templates.module';
import { PushTemplatesModule } from '../push-templates/push-templates.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProjectsModule } from '../projects/projects.module';
import { EmailPolicyModule } from '../email-policy/email-policy.module';
import { QuietHoursService } from '../common/quiet-hours.service';

@Module({
  imports: [
    AdaptersModule,
    ChannelsModule,
    TemplatesModule,
    PushTemplatesModule,
    RealtimeModule,
    ProjectsModule,
    EmailPolicyModule,
  ],
  providers: [MessagesService, QuietHoursService],
  controllers: [
    MessagesController,
    MessagesExtraController,
    PublicMessagesController,
  ],
  exports: [MessagesService, QuietHoursService],
})
export class MessagesModule {}