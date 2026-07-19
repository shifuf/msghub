import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ChannelsService } from './channels.service';
import {
  CreateChannelDto,
  UpdateChannelDto,
  BindChannelDto,
  UpdateBindingDto,
  ReorderBindingsDto,
} from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { ChannelHealthService } from './channel-health.service';

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class ChannelsController {
  constructor(
    private channels: ChannelsService,
    private health: ChannelHealthService,
  ) {}

  @Get('channels')
  async list() {
    return ok(await this.channels.listAll());
  }

  @Get('channels/health')
  async healthList() {
    return ok(await this.health.listHealth());
  }

  @Post('channels/health/probe')
  async probeAll() {
    return ok(await this.health.probeAll());
  }

  @Post('channels')
  async create(@Body() dto: CreateChannelDto) {
    return ok(await this.channels.create(dto));
  }

  @Get('channels/:id')
  async get(@Param('id') id: string) {
    return ok(await this.channels.get(id));
  }

  @Patch('channels/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return ok(await this.channels.update(id, dto));
  }

  @Delete('channels/:id')
  async remove(@Param('id') id: string) {
    return ok(await this.channels.remove(id));
  }

  @Post('channels/:id/test')
  async test(@Param('id') id: string) {
    return ok(await this.channels.test(id));
  }

  @Post('channels/:id/probe')
  async probeOne(@Param('id') id: string) {
    return ok(await this.health.probeOne(id));
  }

  @Post('channels/:id/set-default')
  async setDefault(@Param('id') id: string) {
    return ok(await this.channels.setDefault(id));
  }

  @Get('projects/:projectId/channels')
  async listBindings(@Param('projectId') projectId: string) {
    return ok(await this.channels.listBindings(projectId));
  }

  @Get('projects/:projectId/channel-options')
  async listOptions(@Param('projectId') projectId: string) {
    return ok(await this.channels.listProjectChannelOptions(projectId));
  }

  @Post('projects/:projectId/channels')
  async bind(
    @Param('projectId') projectId: string,
    @Body() dto: BindChannelDto,
  ) {
    return ok(await this.channels.bindChannel(projectId, dto));
  }

  @Patch('projects/:projectId/channels/:channelId')
  async updateBinding(
    @Param('projectId') projectId: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateBindingDto,
  ) {
    return ok(await this.channels.updateBinding(projectId, channelId, dto));
  }

  @Delete('projects/:projectId/channels/:channelId')
  async unbind(
    @Param('projectId') projectId: string,
    @Param('channelId') channelId: string,
  ) {
    return ok(await this.channels.unbindChannel(projectId, channelId));
  }

  /** 兜底顺序：channelIds 从先到后 = priority 10,20,30...；默认渠道固定优先 */
  @Post('projects/:projectId/channel-options/reorder')
  async reorder(
    @Param('projectId') projectId: string,
    @Body() dto: ReorderBindingsDto,
  ) {
    return ok(await this.channels.reorderBindings(projectId, dto.channelIds || []));
  }

  @Post('projects/:projectId/channels/:channelId/set-default')
  async setProjectDefault(
    @Param('projectId') projectId: string,
    @Param('channelId') channelId: string,
  ) {
    return ok(await this.channels.setProjectDefault(projectId, channelId));
  }

  @Post('projects/:projectId/channels/:channelId/set-backup')
  async setProjectBackup(
    @Param('projectId') projectId: string,
    @Param('channelId') channelId: string,
  ) {
    return ok(await this.channels.setProjectBackup(projectId, channelId));
  }
}
