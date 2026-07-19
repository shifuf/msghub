import { Module } from '@nestjs/common';
import { SimplePushController } from './simple-push.controller';
import { MessagesModule } from '../messages/messages.module';
import { ProjectsModule } from '../projects/projects.module';
import { EmailPolicyModule } from '../email-policy/email-policy.module';
import { TemplatesModule } from '../templates/templates.module';
import { IdempotencyService } from '../common/idempotency.service';
import { ProjectRateLimitService } from '../common/project-rate-limit.service';

@Module({
  imports: [MessagesModule, ProjectsModule, EmailPolicyModule, TemplatesModule],
  controllers: [SimplePushController],
  providers: [IdempotencyService, ProjectRateLimitService],
  exports: [IdempotencyService, ProjectRateLimitService],
})
export class OpenApiModule {}
