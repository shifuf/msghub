import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ChannelType } from '@prisma/client';

export class AdminSendDto {
  @IsString()
  projectId: string;

  @IsOptional()
  @IsString()
  channelId?: string;

  @IsOptional()
  @IsEnum(ChannelType)
  channelType?: ChannelType;

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
  @IsString()
  pushTemplate?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}

export class BatchSendDto {
  @IsString()
  @MinLength(1)
  projectId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channelIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(ChannelType, { each: true })
  channelTypes?: ChannelType[];

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
}

export class ClearMessagesDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsBoolean()
  onlyFailed?: boolean;

  /** ISO 时间，删除此时间之前的记录 */
  @IsOptional()
  @IsString()
  before?: string;
}

export class BatchResendDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  toAddress?: string;

  /** 默认 true：仅 SMTP 失败 */
  @IsOptional()
  @IsBoolean()
  onlySmtpFailed?: boolean;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  limit?: number;
}

export class IdsDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class CleanupDto {
  @IsOptional()
  @IsString()
  before?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsBoolean()
  onlyInbox?: boolean;

  @IsOptional()
  @IsBoolean()
  onlyArchived?: boolean;
}
