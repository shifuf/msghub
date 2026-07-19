import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateApiKeyDto, CreateProjectDto, UpdateProjectDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@UseGuards(JwtAuthGuard)
@Controller('admin/projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Get()
  async list() {
    return ok(await this.projects.list());
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.projects.get(id));
  }

  @Post()
  async create(@Body() dto: CreateProjectDto) {
    return ok(await this.projects.create(dto));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return ok(await this.projects.update(id, dto));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.projects.remove(id));
  }

  @Post(':id/reset-key')
  async resetKey(@Param('id') id: string) {
    return ok(await this.projects.resetKey(id));
  }

  @Get(':id/keys')
  async listKeys(@Param('id') id: string) {
    return ok(await this.projects.listKeys(id));
  }

  @Post(':id/keys')
  async createKey(@Param('id') id: string, @Body() dto: CreateApiKeyDto) {
    return ok(await this.projects.createKey(id, dto.name, dto.expiresAt));
  }

  @Delete(':id/keys/:keyId')
  async deleteKey(@Param('id') id: string, @Param('keyId') keyId: string) {
    return ok(await this.projects.deleteKey(id, keyId));
  }

  @Post(':id/keys/:keyId/revoke')
  async revokeKey(@Param('id') id: string, @Param('keyId') keyId: string) {
    return ok(await this.projects.revokeKey(id, keyId));
  }

  @Get(':id/inbound-errors')
  async inboundErrors(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return ok(await this.projects.inboundErrors(id, limit ? Number(limit) : 20));
  }
}
