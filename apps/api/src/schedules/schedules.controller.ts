import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto';
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
  ) {
    return ok(await this.schedules.list({ projectId, status }));
  }

  @Post()
  async create(@Body() dto: CreateScheduleDto) {
    return ok(await this.schedules.create(dto));
  }

  @Delete(':id')
  async cancel(@Param('id') id: string) {
    return ok(await this.schedules.cancel(id));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.schedules.get(id));
  }
}
