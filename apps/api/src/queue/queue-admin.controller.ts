import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { QueueAdminService } from './queue-admin.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/queue')
export class QueueAdminController {
  constructor(private queue: QueueAdminService) {}

  @Get('stats')
  async stats() {
    return ok(await this.queue.stats());
  }

  @Get('failed')
  async failed(@Query('limit') limit?: string) {
    return ok(await this.queue.listFailed(limit ? Number(limit) : 50));
  }

  @Get('delayed')
  async delayed(@Query('limit') limit?: string) {
    return ok(await this.queue.listDelayed(limit ? Number(limit) : 50));
  }

  @Post('failed/:jobId/retry')
  async retry(@Param('jobId') jobId: string) {
    return ok(await this.queue.retryFailed(jobId));
  }

  @Post('failed/:jobId/remove')
  async remove(@Param('jobId') jobId: string) {
    return ok(await this.queue.removeFailed(jobId));
  }
}
