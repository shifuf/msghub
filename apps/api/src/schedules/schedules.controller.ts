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
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto, UpdateScheduleDto, ResolveScheduleDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@UseGuards(JwtAuthGuard)
@Controller('admin/schedules')
export class SchedulesController {
  constructor(private schedules: SchedulesService) {}

  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.schedules.list({ projectId, status, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined }));
  }

  @Post()
  async create(@Body() dto: CreateScheduleDto) {
    return ok(await this.schedules.create(dto));
  }

  @Delete(':id')
  async cancel(@Param('id') id: string) {
    return ok(await this.schedules.cancel(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateScheduleDto) { return ok(await this.schedules.update(id, dto)); }

  @Post(':id/pause')
  async pause(@Param('id') id: string) { return ok(await this.schedules.pause(id)); }

  @Post(':id/resume')
  async resume(@Param('id') id: string) { return ok(await this.schedules.resume(id)); }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string, @Body() dto: ResolveScheduleDto) { return ok(await this.schedules.resolve(id, dto)); }

  @Get(':id/executions')
  async history(@Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return ok(await this.schedules.history(id, { page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined }));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.schedules.get(id));
  }
}
