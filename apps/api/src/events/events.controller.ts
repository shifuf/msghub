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
import { MessagePriority } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { EventsService } from './events.service';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

class CreateEventDto {
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(MessagePriority) defaultPriority?: MessagePriority;
  @IsOptional() @IsString() pushTemplateCode?: string;
  @IsOptional() @IsString() emailTemplateCode?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateEventDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(MessagePriority) defaultPriority?: MessagePriority;
  @IsOptional() @IsString() pushTemplateCode?: string | null;
  @IsOptional() @IsString() emailTemplateCode?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('admin/events')
export class EventsController {
  constructor(private events: EventsService) {}

  @Get()
  async list(@Query('projectId') projectId?: string) {
    return ok(await this.events.list(projectId));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.events.get(id));
  }

  @Post()
  async create(@Body() dto: CreateEventDto) {
    return ok(await this.events.create(dto));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return ok(await this.events.update(id, dto));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.events.remove(id));
  }
}
