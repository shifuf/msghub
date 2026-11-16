import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  MinLength,
} from 'class-validator';
import { ChannelType } from '@prisma/client';

export class CreateScheduleDto {
  @IsString()
  @MinLength(1)
  projectId: string;

  @IsOptional()
  @IsString()
  channelId?: string;

  @IsOptional()
  @IsEnum(ChannelType)
  channelType?: ChannelType;

  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  template?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsDateString()
  runAt: string;

  @IsOptional()
  @IsString()
  cron?: string;
}

export class UpdateScheduleDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() html?: string;
  @IsOptional() @IsDateString() runAt?: string;
  @IsOptional() @IsString() cron?: string;
  @IsOptional() @IsObject() variables?: Record<string, unknown>;
}

export class ResolveScheduleDto {
  @IsIn(['delivered', 'retry']) action: 'delivered' | 'retry';
  @IsOptional() @IsBoolean() acknowledgeDuplicateRisk?: boolean;
}
