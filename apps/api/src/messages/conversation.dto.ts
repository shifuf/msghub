import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ConversationAccessDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  messageId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;
}

export class ConversationReplyDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  @IsUUID()
  clientId!: string;
}

export class PublicConversationReplyDto extends ConversationAccessDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  @IsUUID()
  clientId!: string;
}

export class ConversationInboxQueryDto {
  @IsOptional()
  @IsIn(['open', 'closed', 'all'])
  status?: 'open' | 'closed' | 'all' = 'open';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' ? true : value === false || value === 'false' ? false : value)
  @IsBoolean()
  unread?: boolean = false;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(128)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === undefined ? 1 : Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => value === undefined ? 20 : Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class ConversationHistoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === undefined ? 100 : Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 100;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  before?: string;
}

export class UpdateConversationDto {
  @IsIn(['open', 'closed'])
  status!: 'open' | 'closed';
}
