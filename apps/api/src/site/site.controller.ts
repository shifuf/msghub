import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { SiteService } from './site.service';

class SiteSettingsDto {
  @IsOptional() @IsString() siteName?: string;
  @IsOptional() @IsString() siteIcp?: string;
  @IsOptional() @IsString() sitePolice?: string;
  @IsOptional() @IsString() sitePoliceUrl?: string;
  @IsOptional() @IsString() siteCopyright?: string;
  @IsOptional() @IsString() siteContactEmail?: string;
  @IsOptional() @IsString() siteDescription?: string;
  @IsOptional() @IsString() globalAdminEmail?: string;
  @IsOptional() @IsString() messageRetentionDays?: string;
  @IsOptional() @IsString() activityRetentionDays?: string;
  @IsOptional() @IsString() sensitiveRetentionDays?: string;
}

class PartnerDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) url!: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsInt() displayOrder?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class PartnerUpdateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() logoUrl?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() displayOrder?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class SiteAdminController {
  constructor(private site: SiteService) {}

  @Get('settings')
  async getSettings() {
    return ok(await this.site.getSiteSettings());
  }

  @Put('settings')
  async putSettings(@Body() dto: SiteSettingsDto) {
    return ok(await this.site.updateSiteSettings(dto));
  }

  @Get('partners')
  async listPartners() {
    return ok(await this.site.listPartners(true));
  }

  @Post('partners')
  async createPartner(@Body() dto: PartnerDto) {
    return ok(await this.site.createPartner(dto));
  }

  @Patch('partners/:id')
  async updatePartner(@Param('id') id: string, @Body() dto: PartnerUpdateDto) {
    return ok(await this.site.updatePartner(id, dto));
  }

  @Delete('partners/:id')
  async removePartner(@Param('id') id: string) {
    return ok(await this.site.removePartner(id));
  }
}

@Controller('public')
export class SitePublicController {
  constructor(private site: SiteService) {}

  @Get('site')
  async siteInfo() {
    return ok(await this.site.publicSite());
  }

  @Get('partners')
  async partners() {
    return ok(await this.site.listPartners(false));
  }
}
