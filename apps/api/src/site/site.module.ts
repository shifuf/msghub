import { Module } from '@nestjs/common';
import { SiteService } from './site.service';
import { SiteAdminController, SitePublicController } from './site.controller';
import { RetentionService } from './retention.service';

@Module({
  providers: [SiteService, RetentionService],
  controllers: [SiteAdminController, SitePublicController],
  exports: [SiteService],
})
export class SiteModule {}
