import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, MessageLog, MessageReply } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../adapters/adapters.registry';
import { resolveUnsubscribeSecret, signConversationToken, signReadToken, verifyConversationToken } from '../common/token.util';
import { safeAdapterSend } from '../common/delivery.util';
import { sanitizeErrorMessage } from '../common/utils';
import { RealtimeService } from '../realtime/realtime.service';
import { ConversationHistoryQueryDto, ConversationInboxQueryDto, ConversationReplyDto, UpdateConversationDto } from './conversation.dto';

type ConversationReplyEvent = { kind: 'reply'; messageId: string; replyId: string; author: 'admin' | 'device'; createdAt: string; deliveryStatus: string };
type ConversationReadEvent = { kind: 'read'; messageId: string; reader: 'admin' | 'device'; count: number };
type ConversationStatusEvent = { kind: 'status'; messageId: string; status: 'open' | 'closed' };
type ConversationEvent = ConversationReplyEvent | ConversationReadEvent | ConversationStatusEvent;

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService, private adapters: AdapterRegistry, private config: ConfigService, private realtime: RealtimeService) {}

  private secret() {
    try {
      return resolveUnsubscribeSecret(this.config.get('UNSUBSCRIBE_SECRET') || this.config.get('JWT_SECRET'), { allowDevFallback: true });
    } catch { throw new ServiceUnavailableException('会话服务未配置安全密钥'); }
  }

  private authorize(messageId: string, token: string) {
    if (typeof messageId !== 'string' || !messageId || messageId.length > 128 || typeof token !== 'string' || token.length > 512 || !verifyConversationToken(messageId, token, this.secret())) {
      throw new ForbiddenException('会话凭证无效');
    }
  }

  private async message(messageId: string) {
    const message = await this.prisma.messageLog.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('消息记录不存在');
    return message;
  }

  private canReply(message: MessageLog) {
    const extra = (message.payload as any)?.extra;
    return message.channelType === ChannelType.JPUSH && extra?.conversationId === message.id && !!extra?._jpushAudience && !!extra?._jpushAppKey;
  }

  async getPublic(messageId: string, token: string) {
    this.authorize(messageId, token);
    return this.conversation(await this.message(messageId), 'device');
  }

  async getAdmin(messageId: string, query: ConversationHistoryQueryDto = {}) { return this.conversation(await this.message(messageId), 'admin', query); }

  private emitConversation(event: ConversationEvent) { this.realtime.emit('conversation', event); }

  private async conversation(message: MessageLog, reader: 'device' | 'admin', query: ConversationHistoryQueryDto = {}) {
    const canReply = this.canReply(message);
    if (!canReply && reader === 'device') throw new BadRequestException('旧通知不支持会话，请接收新版通知');
    const opposite = reader === 'device' ? 'admin' : 'device';
    const limit = reader === 'device' ? 100 : Math.min(Math.max(Number(query.limit) || 100, 1), 100);
    const snapshot = await this.prisma.$transaction(async tx => {
      // A process crash during push is ambiguous: retain history, never auto-send twice.
      await tx.messageReply.updateMany({
        where: { messageId: message.id, deliveryStatus: 'PENDING', createdAt: { lt: new Date(Date.now() - 120000) } },
        data: { deliveryStatus: 'UNCERTAIN', deliveryError: '推送处理已中断，送达结果待核实；回复已保存在会话中' },
      });
      let cursor: MessageReply | null = null;
      if (reader === 'admin' && query.before) {
        cursor = await tx.messageReply.findUnique({ where: { id: query.before } });
        if (!cursor || cursor.messageId !== message.id) throw new BadRequestException('会话分页游标无效');
      }
      const window = await tx.messageReply.findMany({
        where: { messageId: message.id, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      });
      const hasOlder = window.length > limit;
      const recent = window.slice(0, limit);
      const unread = recent.filter(reply => reply.author === opposite && !reply.readAt);
      const readAt = new Date();
      let readCount = 0;
      if (unread.length) readCount = (await tx.messageReply.updateMany({ where: { id: { in: unread.map(reply => reply.id) }, author: opposite, readAt: null }, data: { readAt } })).count;
      return { replies: recent.reverse().map(reply => this.present({ ...reply, readAt: reply.author === opposite && !reply.readAt ? readAt : reply.readAt })), hasOlder, nextCursor: hasOlder ? recent[0]?.id || null : null, readCount };
    });
    if (snapshot.readCount) this.emitConversation({ kind: 'read', messageId: message.id, reader, count: snapshot.readCount });
    return {
      messageId: message.id, title: message.title || '', content: message.content || '', replies: snapshot.replies, canReply,
      status: message.conversationClosedAt ? 'closed' : 'open', closedAt: message.conversationClosedAt || null,
      activityAt: message.conversationActivityAt || null, hasOlder: snapshot.hasOlder, nextCursor: snapshot.nextCursor,
    };
  }

  async list(query: ConversationInboxQueryDto = {}) {
    const status = query.status || 'open';
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const where: any = { channelType: ChannelType.JPUSH, conversationActivityAt: { not: null } };
    if (status === 'open') where.conversationClosedAt = null;
    if (status === 'closed') where.conversationClosedAt = { not: null };
    const filters: any[] = [];
    if (search) filters.push({ OR: [
      { id: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
      { replies: { some: { content: { contains: search, mode: 'insensitive' } } } },
    ] });
    if (query.unread) filters.push({ replies: { some: { author: 'device', readAt: null } } });
    if (filters.length) where.AND = filters;
    const unreadWhere = { author: 'device', readAt: null, message: { channelType: ChannelType.JPUSH, conversationActivityAt: { not: null } } };

    const [total, items, unreadCount] = await Promise.all([
      this.prisma.messageLog.count({ where }),
      this.prisma.messageLog.findMany({
        where, orderBy: [{ conversationActivityAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, title: true, conversationClosedAt: true, conversationActivityAt: true,
          replies: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, author: true, content: true, createdAt: true } } },
      }),
      this.prisma.messageReply.count({ where: unreadWhere }),
    ]);
    if (!items.length) return { items: [], total, page, pageSize, unreadCount };

    const groupedUnread = await this.prisma.messageReply.groupBy({
      by: ['messageId'], where: { author: 'device', readAt: null, messageId: { in: items.map(item => item.id) } }, _count: { _all: true },
    });
    const unreadByMessage = new Map(groupedUnread.map(row => [row.messageId, row._count._all]));
    return {
      items: items.map(message => ({
        messageId: message.id, title: message.title || '', status: message.conversationClosedAt ? 'closed' : 'open',
        closedAt: message.conversationClosedAt, activityAt: message.conversationActivityAt, unreadCount: unreadByMessage.get(message.id) || 0,
        lastReply: message.replies[0] ? { id: message.replies[0].id, author: message.replies[0].author, content: message.replies[0].content, createdAt: message.replies[0].createdAt } : null,
      })),
      total, page, pageSize, unreadCount,
    };
  }

  async update(messageId: string, dto: UpdateConversationDto) {
    const status = dto.status;
    const updated = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "MessageLog" WHERE "id" = ${messageId} FOR UPDATE`;
      const message = await tx.messageLog.findUnique({ where: { id: messageId } });
      if (!message) throw new NotFoundException('消息记录不存在');
      if (!this.canReply(message)) throw new BadRequestException('该消息不支持会话');
      if (!message.conversationActivityAt) throw new NotFoundException('尚无回复的会话');
      const isClosed = !!message.conversationClosedAt;
      if ((status === 'closed') === isClosed) return { changed: false, messageId, status: isClosed ? 'closed' as const : 'open' as const, closedAt: message.conversationClosedAt };
      const closedAt = status === 'closed' ? new Date() : null;
      const saved = await tx.messageLog.update({ where: { id: messageId }, data: { conversationClosedAt: closedAt } });
      return { changed: true, messageId, status, closedAt: saved.conversationClosedAt };
    });
    if (updated.changed) this.emitConversation({ kind: 'status', messageId, status: updated.status });
    const { changed: _changed, ...result } = updated;
    return result;
  }

  async replyPublic(messageId: string, token: string, dto: ConversationReplyDto) {
    this.authorize(messageId, token);
    return this.reply(await this.message(messageId), 'device', dto);
  }

  async replyAdmin(messageId: string, dto: ConversationReplyDto) { return this.reply(await this.message(messageId), 'admin', dto); }

  private async reply(message: MessageLog, author: 'device' | 'admin', dto: ConversationReplyDto) {
    if (!this.canReply(message)) throw new BadRequestException('旧通知或非设备通知不支持会话');
    const content = typeof dto.content === 'string' ? dto.content.trim() : '';
    if (!content || content.length > 4000 || typeof dto.clientId !== 'string' || !isUUID(dto.clientId)) throw new BadRequestException('回复需为 1–4000 字，clientId 必须是 UUID');
    const clientId = dto.clientId.toLowerCase();
    const unique = { messageId_author_clientId: { messageId: message.id, author, clientId } };
    const inserted = await this.prisma.$transaction(async tx => {
      // Serialize closure and insert against this durable message row. Keeping
      // the uniqueness check under the lock also makes provider sends idempotent.
      await tx.$queryRaw`SELECT "id" FROM "MessageLog" WHERE "id" = ${message.id} FOR UPDATE`;
      const current = await tx.messageLog.findUnique({ where: { id: message.id } });
      if (!current) throw new NotFoundException('消息记录不存在');
      const previous = await tx.messageReply.findUnique({ where: unique });
      if (previous) return { reply: previous, created: false };
      if (current.conversationClosedAt) throw new ConflictException('会话已关闭，请联系管理员重新开启');
      const reply = await tx.messageReply.create({ data: { messageId: current.id, author, content, clientId, deliveryStatus: author === 'device' ? 'STORED' : 'PENDING' } });
      const activityAt = current.conversationActivityAt && current.conversationActivityAt > reply.createdAt ? current.conversationActivityAt : reply.createdAt;
      await tx.messageLog.update({ where: { id: current.id }, data: { conversationActivityAt: activityAt } });
      return { reply, created: true };
    });
    if (!inserted.created) return this.existing(inserted.reply, content);
    let reply = inserted.reply;
    if (author === 'device') {
      const result = this.present(reply);
      this.emitConversation({ kind: 'reply', messageId: message.id, replyId: reply.id, author, createdAt: result.createdAt.toISOString(), deliveryStatus: reply.deliveryStatus });
      return result;
    }

    // Persist first. Errors never erase the conversation or pretend the device received it.
    let deliveryStatus = 'FAILED';
    let deliveryError: string | null = null;
    try {
      const channel = message.channelId ? await this.prisma.channel.findUnique({ where: { id: message.channelId } }) : null;
      if (!channel || !channel.enabled || channel.type !== ChannelType.JPUSH) throw new Error('原始极光渠道不存在或已禁用，回复已保存');
      const config = channel.config as Record<string, unknown>;
      const original = (message.payload as any).extra;
      if (config.appKey !== original._jpushAppKey) throw new Error('原始极光应用已更改，无法安全发送回复');
      const secret = this.secret();
      const token = signConversationToken(message.id, secret);
      const result = await safeAdapterSend(this.adapters, ChannelType.JPUSH, config, {
        title: message.title || '消息回复', content,
        extra: { _jpushAudience: original._jpushAudience, messageId: message.id, conversationId: message.id, conversationToken: token, readToken: signReadToken(message.id, secret), replyId: reply.id },
      });
      deliveryStatus = result.success ? 'ACCEPTED' : 'FAILED';
      deliveryError = result.success ? null : sanitizeErrorMessage(result.errorMessage?.replaceAll(token, '[REDACTED]')) || '推送未成功，回复已保存';
    } catch (error: any) { deliveryError = sanitizeErrorMessage(error?.message) || '推送失败，回复已保存'; }
    reply = await this.prisma.messageReply.update({ where: { id: reply.id }, data: { deliveryStatus, deliveryError } });
    const result = this.present(reply);
    this.emitConversation({ kind: 'reply', messageId: message.id, replyId: reply.id, author, createdAt: result.createdAt.toISOString(), deliveryStatus: reply.deliveryStatus });
    return result;
  }

  private existing(reply: MessageReply, content: string) {
    if (reply.content !== content) throw new ConflictException('clientId 已用于不同回复，请使用新的 UUID');
    return this.present(reply);
  }

  private present(reply: MessageReply) {
    return { id: reply.id, author: reply.author, content: reply.content, createdAt: reply.createdAt, readAt: reply.readAt, clientId: reply.clientId, deliveryStatus: reply.deliveryStatus, deliveryError: reply.deliveryError };
  }
}
