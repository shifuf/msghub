import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** 项目管理员邮箱；空字符串清除 */
  @IsOptional()
  @IsString()
  adminEmail?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  alertFailRatePct?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  alertWindowMin?: number;

  /** 每日 SMTP 配额；null/0=不限 */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  dailyEmailQuota?: number | null;

  /** 连续失败自动拉黑阈值；0=关闭 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  emailFailSuppressCount?: number;

  /** 失败告警冷却分钟 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  alertCooldownMin?: number;

  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: 'quietStart 格式 HH:mm' })
  quietStart?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: 'quietEnd 格式 HH:mm' })
  quietEnd?: string | null;

  @IsOptional()
  @IsString()
  quietTimezone?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  rateLimitPerMin?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  idempotencyTtlMin?: number;

  /** 未读超过 N 小时后邮件兜底 */
  @IsOptional()
  @IsBoolean()
  unreadEmailFallbackEnabled?: boolean;

  /** 未读超过 N 分钟后邮件兜底（字段名历史为 Hours，语义为分钟） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(43200)
  unreadEmailFallbackHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(43200)
  unreadEmailFallbackMinutes?: number;

  /** 未读兜底邮件模板 code；空=纯文本标题/正文 */
  @IsOptional()
  @IsString()
  unreadEmailTemplateCode?: string | null;
}

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class SimulateSendDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  channelIds?: string[];
}
