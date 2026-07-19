import { Module } from '@nestjs/common';
import { SiteService } from './site.service';
import { SiteAdminController, SitePublicController } from './site.controller';

@Module({
  providers: [SiteService],
  controllers: [SiteAdminController, SitePublicController],
  exports: [SiteService],
})
export class SiteModule {}
