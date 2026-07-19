import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SITE_KEYS = [
  'siteName',
  'siteIcp',
  'sitePolice',
  'sitePoliceUrl',
  'siteCopyright',
  'siteContactEmail',
  'siteDescription',
] as const;

export type SiteSettings = {
  siteName: string;
  siteIcp: string;
  sitePolice: string;
  sitePoliceUrl: string;
  siteCopyright: string;
  siteContactEmail: string;
  siteDescription: string;
  globalAdminEmail: string;
};

@Injectable()
export class SiteService {
  constructor(private prisma: PrismaService) {}

  private emptySite(): SiteSettings {
    return {
      siteName: '消息推送平台',
      siteIcp: '',
      sitePolice: '',
      sitePoliceUrl: '',
      siteCopyright: '',
      siteContactEmail: '',
      siteDescription: '',
      globalAdminEmail: '',
    };
  }

  async getSiteSettings(): Promise<SiteSettings> {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [...SITE_KEYS, 'globalAdminEmail'],
        },
      },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const base = this.emptySite();
    for (const k of SITE_KEYS) {
      if (map.has(k)) (base as any)[k] = map.get(k) || '';
    }
    base.globalAdminEmail = map.get('globalAdminEmail') || '';
    return base;
  }

  async updateSiteSettings(partial: Partial<SiteSettings>) {
    const allowed: (keyof SiteSettings)[] = [
      ...SITE_KEYS,
      'globalAdminEmail',
    ];
    for (const key of allowed) {
      if (partial[key] === undefined) continue;
      const value = String(partial[key] ?? '').trim();
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    return this.getSiteSettings();
  }

  async publicSite() {
    const s = await this.getSiteSettings();
    return {
      siteName: s.siteName || '消息推送平台',
      siteIcp: s.siteIcp || '',
      sitePolice: s.sitePolice || '',
      sitePoliceUrl: s.sitePoliceUrl || '',
      siteCopyright: s.siteCopyright || '',
      siteContactEmail: s.siteContactEmail || '',
      siteDescription: s.siteDescription || '',
    };
  }

  listPartners(all = false) {
    return this.prisma.partnerLink.findMany({
      where: all ? {} : { enabled: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getPartner(id: string) {
    const row = await this.prisma.partnerLink.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('合作站不存在');
    return row;
  }

  async createPartner(data: {
    name: string;
    url: string;
    logoUrl?: string;
    description?: string;
    displayOrder?: number;
    enabled?: boolean;
  }) {
    const name = (data.name || '').trim();
    const url = (data.url || '').trim();
    if (!name) throw new BadRequestException('名称不能为空');
    if (!url) throw new BadRequestException('链接不能为空');
    this.assertHttpUrl(url);
    if (data.logoUrl) this.assertHttpUrl(data.logoUrl, true);
    return this.prisma.partnerLink.create({
      data: {
        name,
        url,
        logoUrl: data.logoUrl?.trim() || null,
        description: data.description?.trim() || null,
        displayOrder: data.displayOrder ?? 0,
        enabled: data.enabled !== false,
      },
    });
  }

  async updatePartner(
    id: string,
    data: {
      name?: string;
      url?: string;
      logoUrl?: string | null;
      description?: string | null;
      displayOrder?: number;
      enabled?: boolean;
    },
  ) {
    await this.getPartner(id);
    if (data.url !== undefined) this.assertHttpUrl(data.url);
    if (data.logoUrl) this.assertHttpUrl(data.logoUrl, true);
    return this.prisma.partnerLink.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        url: data.url?.trim(),
        logoUrl:
          data.logoUrl === undefined
            ? undefined
            : data.logoUrl?.trim() || null,
        description:
          data.description === undefined
            ? undefined
            : data.description?.trim() || null,
        displayOrder: data.displayOrder,
        enabled: data.enabled,
      },
    });
  }

  async removePartner(id: string) {
    await this.getPartner(id);
    await this.prisma.partnerLink.delete({ where: { id } });
    return { deleted: true };
  }

  private assertHttpUrl(url: string, allowEmpty = false) {
    const u = (url || '').trim();
    if (!u) {
      if (allowEmpty) return;
      throw new BadRequestException('链接不能为空');
    }
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new BadRequestException('链接格式无效');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('链接仅支持 http/https');
    }
  }
}
