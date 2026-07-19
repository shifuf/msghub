import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@UseGuards(JwtAuthGuard)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('stats')
  async stats() {
    return ok(await this.dashboard.stats());
  }

  @Get('notifications')
  async notifications(
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    return ok(
      await this.dashboard.notifications(since, limit ? Number(limit) : 20),
    );
  }

  @Get('charts')
  async charts(@Query('days') days?: string) {
    return ok(await this.dashboard.charts(days ? Number(days) : 7));
  }

  @Get('error-clusters')
  async errorClusters(@Query('days') days?: string) {
    return ok(await this.dashboard.errorClusters(days ? Number(days) : 7));
  }
}
