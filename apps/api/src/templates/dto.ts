import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateTemplateDto {
  @IsOptional()
  @IsString()
  projectId?: string | null;

  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  subject: string;

  @IsString()
  htmlBody: string;

  @IsOptional()
  @IsString()
  textBody?: string;

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  htmlBody?: string;

  @IsOptional()
  @IsString()
  textBody?: string;

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CopyTemplateDto {
  @IsOptional()
  @IsString()
  targetProjectId?: string | null;

  @IsOptional()
  @IsString()
  newCode?: string;
}

export class PreviewTemplateDto {
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}

export class SeedTemplatesDto {
  @IsOptional()
  @IsString()
  projectId?: string | null;
}
