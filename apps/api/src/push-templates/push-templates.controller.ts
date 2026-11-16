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
  Put,
} from '@nestjs/common';
import { PushTemplatesService } from './push-templates.service';
import {
  CreatePushTemplateDto,
  UpdatePushTemplateDto,
  PreviewPushTemplateDto,
} from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { TemplateVersionsService } from '../templates/template-versions.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/push-templates')
export class PushTemplatesController {
  constructor(private pushTemplates: PushTemplatesService, private versions: TemplateVersionsService) {}

  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('enabled') enabled?: string,
    @Query('includeGlobal') includeGlobal?: string,
  ) {
    const enabledFilter =
      enabled === 'true' ? true : enabled === 'false' ? false : undefined;
    return ok(
      await this.pushTemplates.list(
        projectId,
        enabledFilter,
        includeGlobal === 'true' || includeGlobal === '1',
      ),
    );
  }

  @Post('seed-defaults')
  async seedDefaults(@Body() body: { projectId?: string | null } = {}) {
    return ok(await this.pushTemplates.seedDefaults(body.projectId ?? null));
  }

  @Post()
  async create(@Body() dto: CreatePushTemplateDto) {
    return ok(await this.pushTemplates.create(dto));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.pushTemplates.get(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePushTemplateDto) {
    return ok(await this.versions.publish('push', id, dto));
  }

  @Get(':id/versions')
  async history(@Param('id') id: string) { return ok(await this.versions.history('push', id)); }

  @Put(':id/draft')
  async draft(@Param('id') id: string, @Body() dto: UpdatePushTemplateDto) { return ok(await this.versions.saveDraft('push', id, dto)); }

  @Post(':id/publish')
  async publish(@Param('id') id: string) { return ok(await this.versions.publish('push', id)); }

  @Post(':id/rollback')
  async rollback(@Param('id') id: string, @Body() body: { revision: number }) { return ok(await this.versions.rollback('push', id, body?.revision)); }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.pushTemplates.remove(id));
  }

  @Post(':id/preview')
  async preview(@Param('id') id: string, @Body() dto: PreviewPushTemplateDto) {
    return ok(await this.pushTemplates.preview(id, dto.variables || {}));
  }
}
