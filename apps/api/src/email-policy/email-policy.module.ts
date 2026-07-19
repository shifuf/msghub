import { Module } from '@nestjs/common';
import { EmailPolicyService } from './email-policy.service';
import { EmailPolicyController } from './email-policy.controller';
import { UnsubscribeController } from './unsubscribe.controller';

@Module({
  providers: [EmailPolicyService],
  controllers: [EmailPolicyController, UnsubscribeController],
  exports: [EmailPolicyService],
})
export class EmailPolicyModule {}
