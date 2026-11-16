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
import { TemplatesService } from './templates.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  CopyTemplateDto,
  PreviewTemplateDto,
  SeedTemplatesDto,
} from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { TemplateVersionsService } from './template-versions.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/templates')
export class TemplatesController {
  constructor(private templates: TemplatesService, private versions: TemplateVersionsService) {}

  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('enabled') enabled?: string,
    @Query('includeGlobal') includeGlobal?: string,
  ) {
    const enabledFilter =
      enabled === 'true' ? true : enabled === 'false' ? false : undefined;
    return ok(
      await this.templates.list(
        projectId,
        enabledFilter,
        includeGlobal === 'true' || includeGlobal === '1',
      ),
    );
  }

  @Post('seed-defaults')
  async seed(@Body() dto: SeedTemplatesDto) {
    return ok(await this.templates.seedDefaults(dto.projectId));
  }

  @Post()
  async create(@Body() dto: CreateTemplateDto) {
    return ok(await this.templates.create(dto));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.templates.get(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return ok(await this.versions.publish('email', id, dto));
  }

  @Get(':id/versions')
  async history(@Param('id') id: string) { return ok(await this.versions.history('email', id)); }

  @Put(':id/draft')
  async draft(@Param('id') id: string, @Body() dto: UpdateTemplateDto) { return ok(await this.versions.saveDraft('email', id, dto)); }

  @Post(':id/publish')
  async publish(@Param('id') id: string) { return ok(await this.versions.publish('email', id)); }

  @Post(':id/rollback')
  async rollback(@Param('id') id: string, @Body() body: { revision: number }) { return ok(await this.versions.rollback('email', id, body?.revision)); }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.templates.remove(id));
  }

  @Post(':id/copy')
  async copy(@Param('id') id: string, @Body() dto: CopyTemplateDto) {
    return ok(await this.templates.copy(id, dto.targetProjectId, dto.newCode));
  }

  @Post(':id/preview')
  async preview(@Param('id') id: string, @Body() dto: PreviewTemplateDto) {
    return ok(await this.templates.preview(id, dto.variables || {}));
  }
}
