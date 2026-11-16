import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@UseGuards(JwtAuthGuard)
@Controller('admin/backup')
export class BackupController {
  constructor(private backup: BackupService) {}

  @Get('export')
  async export() {
    return ok(await this.backup.exportConfig());
  }

  @Post('export')
  async protectedExport(@Body() body: any) {
    return ok(await this.backup.exportConfig({ password: body?.password, redact: body?.redact === true }));
  }

  @Post('preview')
  async preview(@Body() body: any) {
    const payload = body?.version ? body : body?.data;
    return ok(await this.backup.previewImport(payload, { password: body?.password }));
  }

  @Post('import')
  async import(@Body() body: any) {
    // 允许直接 body 即导出 JSON，或 { data: ... }
    const payload = body?.version ? body : body?.data;
    return ok(await this.backup.importConfig(payload, { password: body?.password }));
  }
}
