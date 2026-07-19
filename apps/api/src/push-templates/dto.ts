import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreatePushTemplateDto {
  @IsOptional()
  @IsString()
  projectId?: string | null;

  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  titleTpl?: string;

  @IsString()
  contentTpl: string;

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdatePushTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  titleTpl?: string;

  @IsOptional()
  @IsString()
  contentTpl?: string;

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class PreviewPushTemplateDto {
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}
