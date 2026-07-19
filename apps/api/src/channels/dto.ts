import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ChannelType } from '@prisma/client';

export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(ChannelType)
  type: ChannelType;

  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class BindChannelDto {
  @IsString()
  @MinLength(1)
  channelId: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isBackup?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdateBindingDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isBackup?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class ReorderBindingsDto {
  @IsArray()
  @IsString({ each: true })
  channelIds: string[];
}