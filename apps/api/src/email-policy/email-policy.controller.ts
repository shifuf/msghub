import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { EmailPolicyService, SuppressSource } from './email-policy.service';

class AddSuppressDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  address!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  source?: SuppressSource;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class EmailPolicyController {
  constructor(private policy: EmailPolicyService) {}

  @Get('suppress')
  async list(
    @Query('projectId') projectId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.policy.listSuppress({
        projectId,
        q,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Post('suppress')
  async add(@Body() dto: AddSuppressDto) {
    return ok(
      await this.policy.addSuppress({
        projectId: dto.projectId,
        address: dto.address,
        reason: dto.reason,
        source: dto.source || 'MANUAL',
        expiresAt: dto.expiresAt,
      }),
    );
  }

  @Delete('suppress/:id')
  async remove(@Param('id') id: string) {
    return ok(await this.policy.removeSuppress(id));
  }

  @Get('projects/:id/health')
  async health(@Param('id') id: string) {
    return ok(await this.policy.projectHealth(id));
  }
}
