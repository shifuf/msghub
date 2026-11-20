import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { hashDeviceCredential, resolveUnsubscribeSecret, verifyDeviceReceiptToken } from '../common/token.util';
import { DeviceHeartbeatDto, DeviceReceiptDto } from './device.dto';

const PAIR_WINDOW_MS = 10 * 60_000;
const DEVICE_STALE_MS = 90_000;
const splitRids = (value: unknown) => typeof value === 'string' ? [...new Set(value.trim().split(/[,;\s]+/).filter(Boolean))] : [];
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const maskRid = (value: string) => value.length < 18 ? `${value.slice(0, 4)}…` : `${value.slice(0, 10)}…${value.slice(-6)}`;
const optionalText = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

@Injectable()
export class DevicesService {
  constructor(private prisma: PrismaService, private config: ConfigService, private activity: ActivityService, private realtime: RealtimeService) {}

  private receiptSecret() {
    try { return resolveUnsubscribeSecret(this.config.get('UNSUBSCRIBE_SECRET') || this.config.get('JWT_SECRET'), { allowDevFallback: true }); }
    catch { throw new ServiceUnavailableException('设备回执未配置安全密钥'); }
  }

  async pairableChannels() {
    const channels = await this.prisma.channel.findMany({ where: { type: ChannelType.JPUSH, enabled: true }, select: { id: true, name: true, config: true }, orderBy: { name: 'asc' } });
    return channels.flatMap(channel => {
      const config = channel.config as Record<string, unknown>;
      const appKey = optionalText(config?.appKey, 128);
      if (!appKey || String(config.audienceMode || 'registration_id').trim().toLowerCase() !== 'registration_id') return [];
      return [{ id: channel.id, name: channel.name, appFingerprint: fingerprint(appKey), deviceCount: splitRids(config.registrationId).length }];
    });
  }

  async issuePairingCode(channelId: string, adminId: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.type !== ChannelType.JPUSH || !channel.enabled) throw new NotFoundException('请选择启用中的极光设备渠道');
    const config = channel.config as Record<string, unknown>;
    const appKey = optionalText(config?.appKey, 128);
    if (!appKey) throw new BadRequestException('极光渠道尚未配置 AppKey');
    const mode = String(config.audienceMode || 'registration_id').toLowerCase();
    if (mode !== 'registration_id') throw new BadRequestException('设备配对只支持 Registration ID 定向渠道，不能使用 alias 或全体发送');
    const registrationIds = splitRids(config.registrationId);
    if (registrationIds.length >= 500) throw new ConflictException('渠道目标设备已到上限，请另建极光设备渠道');
    const code = randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + PAIR_WINDOW_MS);
    await this.prisma.devicePairingCode.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] } });
    await this.prisma.devicePairingCode.create({ data: { id: randomBytes(12).toString('hex'), codeHash: hashDeviceCredential(code), appKey, channelId: channel.id, expiresAt, createdBy: adminId } });
    await this.activity.log({ action: 'device.pair_code_create', resource: 'JpushDevice', resourceId: channel.id, resourceName: channel.name, detail: { appFingerprint: fingerprint(appKey), expiresAt: expiresAt.toISOString() } });
    return { channelId: channel.id, channelName: channel.name, appFingerprint: fingerprint(appKey), code, expiresAt };
  }

  private equalDigest(received: string, expected: string) {
    const actual = Buffer.from(received, 'hex'); const wanted = Buffer.from(expected, 'hex');
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  }

  async pair(dto: { code: string; registrationId: string; appKey: string; name?: string; appVersion?: string; osVersion?: string; notificationsEnabled?: boolean; channelEnabled?: boolean; connected?: boolean }) {
    const code = dto.code.trim().toLowerCase(); const registrationId = dto.registrationId.trim(); const appKey = dto.appKey.trim();
    if (!/^[a-f0-9]{16}$/.test(code) || !/^[a-zA-Z0-9_-]{1,512}$/.test(registrationId) || !appKey || appKey.length > 128) throw new BadRequestException('设备配对信息无效');
    const codeHash = hashDeviceCredential(code);
    const pairCode = await this.prisma.devicePairingCode.findUnique({ where: { codeHash } });
    if (!pairCode || pairCode.consumedAt || pairCode.expiresAt <= new Date()) throw new UnauthorizedException('配对码不存在、已过期或已使用');
    if (!this.equalDigest(fingerprint(appKey), fingerprint(pairCode.appKey)) || pairCode.appKey !== appKey) throw new UnauthorizedException('此配对码属于另一个极光应用');
    const bearer = randomBytes(32).toString('base64url'); const credentialHash = hashDeviceCredential(bearer); const now = new Date();

    const device = await this.prisma.$transaction(async tx => {
      // Serialize pairing and RID changes for this app, including different pairing codes.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('msghub:devices'), hashtext(${appKey}))::text`;
      const used = await tx.devicePairingCode.updateMany({ where: { id: pairCode.id, codeHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (!used.count) throw new ConflictException('配对码已被使用，请重新生成');
      await tx.$queryRaw`SELECT id FROM "Channel" WHERE id = ${pairCode.channelId} FOR UPDATE`;
      const channel = await tx.channel.findUnique({ where: { id: pairCode.channelId } });
      if (!channel || !channel.enabled || channel.type !== ChannelType.JPUSH) throw new ConflictException('极光渠道已失效，请重新配对');
      const channelConfig = channel.config as Record<string, unknown>;
      if (channelConfig.appKey !== appKey || String(channelConfig.audienceMode || 'registration_id').trim().toLowerCase() !== 'registration_id') throw new ConflictException('极光应用已更改或不再是设备定向渠道');
      const targetIds = splitRids(channelConfig.registrationId);
      if (!targetIds.includes(registrationId)) {
        if (targetIds.length >= 500) throw new ConflictException('渠道目标设备已到上限，请另建极光设备渠道');
        await tx.channel.update({ where: { id: channel.id }, data: { config: { ...channelConfig, registrationId: [...targetIds, registrationId].join(',') } as any } });
      }

      const previous = await tx.jpushDevice.findUnique({ where: { registrationId } });
      if (previous && previous.appKey !== appKey && !previous.revokedAt) throw new ConflictException('此设备已配对到另一极光应用，请先撤销旧设备');
      const data = { appKey, registrationId, credentialHash, name: optionalText(dto.name, 100), appVersion: optionalText(dto.appVersion, 64), osVersion: optionalText(dto.osVersion, 100), notificationsEnabled: dto.notificationsEnabled ?? null, channelEnabled: dto.channelEnabled ?? null, connected: dto.connected === true, lastSeenAt: now, revokedAt: null };
      return previous
        ? tx.jpushDevice.update({ where: { id: previous.id }, data })
        : tx.jpushDevice.create({ data: { id: randomBytes(12).toString('hex'), ...data } });
    });
    await this.activity.log({ action: 'device.pair', resource: 'JpushDevice', resourceId: device.id, resourceName: optionalText(dto.name, 100) || maskRid(registrationId), detail: { appFingerprint: fingerprint(appKey) } });
    this.realtime.emit('device', { id: device.id, status: device.connected ? 'online' : 'offline' });
    return { id: device.id, token: bearer, registrationId, appKey, targetedChannels: [pairCode.channelId] };
  }

  private async authenticatedDevice(bearer: string | null | undefined) {
    if (!bearer || bearer.length > 256) throw new UnauthorizedException('需要有效的设备配对令牌');
    const hash = hashDeviceCredential(bearer);
    const device = await this.prisma.jpushDevice.findUnique({ where: { credentialHash: hash } });
    if (!device?.id || device.revokedAt || !this.equalDigest(device.credentialHash, hash)) throw new UnauthorizedException('设备令牌已撤销或无效，请重新配对');
    return device;
  }

  async heartbeat(bearer: string | null | undefined, dto: DeviceHeartbeatDto) {
    const device = await this.authenticatedDevice(bearer);
    const registrationId = dto.registrationId.trim(); const appKey = dto.appKey.trim();
    if (!/^[a-zA-Z0-9_-]{1,512}$/.test(registrationId)) throw new BadRequestException('Registration ID 格式无效');
    if (!appKey || appKey !== device.appKey) throw new UnauthorizedException('JPush 应用与配对设备不匹配');
    const updated = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('msghub:devices'), hashtext(${appKey}))::text`;
      const current = await tx.jpushDevice.findUnique({ where: { id: device.id } });
      if (!current || current.revokedAt || current.credentialHash !== device.credentialHash) throw new UnauthorizedException('设备令牌已撤销或更新，请重新配对');
      const existing = await tx.jpushDevice.findFirst({ where: { registrationId, id: { not: current.id } }, select: { id: true } });
      if (existing) throw new ConflictException('当前 Registration ID 已绑定到其他设备');
      if (registrationId !== current.registrationId) {
        const channels = await tx.$queryRaw<Array<{ id: string; config: Record<string, unknown> }>>`SELECT id, config FROM "Channel" WHERE type = 'JPUSH' AND config->>'appKey' = ${appKey} ORDER BY id FOR UPDATE`;
        for (const channel of channels) {
          const cfg = channel.config;
          if (String(cfg.audienceMode || 'registration_id').trim().toLowerCase() !== 'registration_id') continue;
          const targets = splitRids(cfg.registrationId);
          if (!targets.includes(current.registrationId)) continue;
          await tx.channel.update({ where: { id: channel.id }, data: { config: { ...cfg, registrationId: [...new Set(targets.map(rid => rid === current.registrationId ? registrationId : rid))].join(',') } as any } });
        }
      }
      return tx.jpushDevice.update({ where: { id: current.id }, data: {
        registrationId, name: optionalText(dto.name, 100) || current.name,
        ...(dto.appVersion !== undefined ? { appVersion: optionalText(dto.appVersion, 64) } : {}),
        ...(dto.osVersion !== undefined ? { osVersion: optionalText(dto.osVersion, 100) } : {}),
        ...(dto.notificationsEnabled !== undefined ? { notificationsEnabled: dto.notificationsEnabled } : {}),
        ...(dto.channelEnabled !== undefined ? { channelEnabled: dto.channelEnabled } : {}),
        ...(dto.connected !== undefined ? { connected: dto.connected } : {}), lastSeenAt: new Date(),
      } });
    });
    this.realtime.emit('device', { id: updated.id, status: updated.connected ? 'online' : 'offline' });
    return { ok: true, serverTime: updated.lastSeenAt };
  }

  async receipt(dto: DeviceReceiptDto, bearer?: string | null) {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = verifyDeviceReceiptToken(dto.receivedToken, this.receiptSecret(), nowSec, { registrationId: dto.registrationId.trim() });
    if (!token) throw new UnauthorizedException('设备回执签名、设备目标或有效期无效');
    const message = await this.prisma.messageLog.findUnique({ where: { id: token.messageId }, select: { id: true, channelType: true, toAddress: true, payload: true } });
    if (!message || message.channelType !== ChannelType.JPUSH) throw new NotFoundException('推送记录不存在或不接受设备回执');
    const extra = ((message.payload as any)?.extra || {}) as Record<string, unknown>;
    if (extra._jpushAudience ? !isRegistrationTarget(extra._jpushAudience, token.registrationId) : message.toAddress !== token.registrationId) throw new UnauthorizedException('设备签名与原始推送目标不一致');
    const targets = (extra._jpushAudience as any)?.registration_id;
    if (Array.isArray(targets) && new Set(targets).size > 1 && !bearer) throw new UnauthorizedException('多设备推送需先关联设备，再提交匹配本机的回执');
    if (bearer && bearer.length > 256) throw new UnauthorizedException('设备令牌无效');
    const time = new Date();
    const { receipt, deviceId } = await this.prisma.$transaction(async tx => {
      let deviceId: string | null = null;
      if (bearer) {
        const appKey = String(extra._jpushAppKey || '');
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('msghub:devices'), hashtext(${appKey}))::text`;
        const hash = hashDeviceCredential(bearer);
        const device = await tx.jpushDevice.findUnique({ where: { credentialHash: hash } });
        if (!device || device.revokedAt || !this.equalDigest(device.credentialHash, hash) || device.appKey !== appKey || device.registrationId !== token.registrationId) throw new UnauthorizedException('已配对设备与原始推送目标不一致或凭据已撤销');
        deviceId = device.id;
        await tx.jpushDevice.update({ where: { id: device.id }, data: { lastSeenAt: time } });
      }
      await tx.deviceReceipt.upsert({
        where: { messageId_registrationId: { messageId: message.id, registrationId: token.registrationId } },
        create: { id: randomBytes(12).toString('hex'), messageId: message.id, registrationId: token.registrationId, arrivedAt: time, displayedAt: dto.displayed ? time : null },
        update: {},
      });
      if (dto.displayed) await tx.deviceReceipt.updateMany({ where: { messageId: message.id, registrationId: token.registrationId, displayedAt: null }, data: { displayedAt: time } });
      await tx.messageLog.updateMany({ where: { id: message.id, deviceReceivedAt: null }, data: { deviceReceivedAt: time } });
      if (dto.displayed) await tx.messageLog.updateMany({ where: { id: message.id, deviceDisplayedAt: null }, data: { deviceDisplayedAt: time } });
      const receipt = await tx.deviceReceipt.findUniqueOrThrow({ where: { messageId_registrationId: { messageId: message.id, registrationId: token.registrationId } } });
      return { receipt, deviceId };
    });
    this.realtime.emit('device', { id: deviceId, status: receipt.displayedAt ? 'displayed' : 'received', messageId: message.id });
    return { ok: true, messageId: message.id, received: true, displayed: !!receipt.displayedAt };
  }

  async list() {
    const devices = await this.prisma.jpushDevice.findMany({ orderBy: { lastSeenAt: 'desc' }, select: {
      id: true, registrationId: true, appKey: true, name: true, appVersion: true, osVersion: true,
      notificationsEnabled: true, channelEnabled: true, connected: true, lastSeenAt: true, revokedAt: true, createdAt: true,
    } });
    const channels = await this.pairableChannels();
    const channelRids = new Map<string, string[]>();
    const rows = await this.prisma.channel.findMany({ where: { type: ChannelType.JPUSH, enabled: true }, select: { id: true, config: true } });
    for (const row of rows) { const cfg = row.config as Record<string, unknown>; if (typeof cfg.appKey === 'string' && String(cfg.audienceMode || 'registration_id').trim().toLowerCase() === 'registration_id') channelRids.set(fingerprint(cfg.appKey), [...(channelRids.get(fingerprint(cfg.appKey)) || []), ...splitRids(cfg.registrationId)]); }
    return {
      channels,
      items: devices.map(device => ({ id: device.id, name: device.name || maskRid(device.registrationId), registrationId: maskRid(device.registrationId), appFingerprint: fingerprint(device.appKey), appVersion: device.appVersion, osVersion: device.osVersion,
        notificationsEnabled: device.notificationsEnabled, channelEnabled: device.channelEnabled, jpushConnected: device.connected, online: !device.revokedAt && device.lastSeenAt.getTime() >= Date.now() - DEVICE_STALE_MS, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt, createdAt: device.createdAt,
        targetedByEnabledChannel: (channelRids.get(fingerprint(device.appKey)) || []).includes(device.registrationId) }) ),
    };
  }

  async revoke(deviceId: string, adminId: string) {
    const device = await this.prisma.jpushDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('设备不存在');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('msghub:devices'), hashtext(${device.appKey}))::text`;
      await tx.jpushDevice.updateMany({ where: { id: device.id, revokedAt: null }, data: { revokedAt: new Date(), connected: false } });
    });
    await this.activity.log({ action: 'device.revoke', resource: 'JpushDevice', resourceId: device.id, resourceName: device.name || maskRid(device.registrationId), detail: { appFingerprint: fingerprint(device.appKey), adminId } });
    this.realtime.emit('device', { id: device.id, status: 'revoked' });
    return { id: device.id, revoked: true };
  }
}

function isRegistrationTarget(target: unknown, registrationId: string) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return false;
  const values = (target as Record<string, unknown>).registration_id;
  return Array.isArray(values) && values.some(value => value === registrationId);
}
