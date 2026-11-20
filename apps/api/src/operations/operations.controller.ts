import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { BackupConfigDto, VerifyBackupDto } from './dto';
import { OperationsService } from './operations.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/operations')
export class OperationsController {
  constructor(private operations: OperationsService) {}

  @Get('version') async version() { return ok(await this.operations.version()); }
  @Get('backup/status') async backupStatus() { return ok(await this.operations.backupStatus()); }
  @Put('backup/config') async updateBackupConfig(@Body() dto: BackupConfigDto) { return ok(await this.operations.updateBackupConfig(dto)); }
  @Post('backup/run') async runBackup() { return ok(await this.operations.runBackup()); }
  @Post('backup/verify') async verifyBackup(@Body() dto: VerifyBackupDto) { return ok(await this.operations.verifyBackup(dto.backupId)); }
}
