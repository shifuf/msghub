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
import { PushTemplatesService } from './push-templates.service';
import {
  CreatePushTemplateDto,
  UpdatePushTemplateDto,
  PreviewPushTemplateDto,
} from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@UseGuards(JwtAuthGuard)
@Controller('admin/push-templates')
export class PushTemplatesController {
  constructor(private pushTemplates: PushTemplatesService) {}

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
    return ok(await this.pushTemplates.update(id, dto));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.pushTemplates.remove(id));
  }

  @Post(':id/preview')
  async preview(@Param('id') id: string, @Body() dto: PreviewPushTemplateDto) {
    return ok(await this.pushTemplates.preview(id, dto.variables || {}));
  }
}
