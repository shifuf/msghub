import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@UseGuards(JwtAuthGuard)
@Controller('admin/activity')
export class ActivityController {
  constructor(private activity: ActivityService) {}

  @Get()
  async list(
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.activity.list({
        action,
        resource,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Post('clear')
  async clear(
    @Body()
    body: { action?: string; resource?: string; before?: string } = {},
  ) {
    return ok(await this.activity.clear(body || {}));
  }
}
