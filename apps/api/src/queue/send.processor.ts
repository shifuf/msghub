import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ChannelType, MessageSource, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../adapters/adapters.registry';
import { ChannelsService } from '../channels/channels.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SEND_QUEUE, SendJobData } from './queue.constants';
import { sanitizeErrorMessage } from '../common/utils';
import { EmailPolicyService } from '../email-policy/email-policy.service';
import { safeAdapterSend } from '../common/delivery.util';

@Processor(SEND_QUEUE)
export class SendProcessor extends WorkerHost {
  private readonly logger = new Logger(SendProcessor.name);

  constructor(
    private prisma: PrismaService,
    private adapters: AdapterRegistry,
    private channels: ChannelsService,
    private realtime: RealtimeService,
    private emailPolicy: EmailPolicyService,
  ) {
    super();
  }

  private async publish(messageId: string) {
    try {
      const m = await this.prisma.messageLog.findUnique({
        where: { id: messageId },
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true } },
        },
      });
      if (m) this.realtime.emitMessage(m);
    } catch {
      /* ignore */
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<SendJobData> | undefined, error: Error) {
    if (!job || job.attemptsMade < (job.opts.attempts || 1)) return;
    try {
      const log = await this.prisma.messageLog.findUnique({ where: { id: job.data.messageId } });
      if (!log || log.status !== MessageStatus.PENDING) return;
      await this.prisma.messageLog.updateMany({ where: { id: log.id, status: MessageStatus.PENDING }, data: {
        status: MessageStatus.FAILED, nextRetryAt: null,
        errorMessage: (log as any).deliveryStartedAt ? 'DELIVERY_UNKNOWN: worker 执行中断，结果待核实' : sanitizeErrorMessage(error.message),
      } });
      await this.publish(log.id);
    } catch (e: any) { this.logger.warn(`failed-state recovery: ${e?.message}`); }
  }

  private async sendBackupPush(
    projectId: string,
    backup: { id: string; type: ChannelType; config: unknown },
    title: string,
    content: string,
    parentId?: string,
  ) {
    const alertLog = await this.prisma.messageLog.create({
      data: {
        projectId,
        channelId: backup.id,
        channelType: backup.type,
        source: MessageSource.BACKUP_ALERT,
        status: MessageStatus.PENDING,
        title,
        content,
        payload: { title, content } as any,
        parentId: parentId || null,
        attempts: 0,
      },
    });
    const alertCfg = (backup.config || {}) as Record<string, unknown>;
    const alertStarted = Date.now();
    const alertResult = await safeAdapterSend(this.adapters, backup.type, alertCfg, { title, content });
    await this.prisma.messageLog.update({
      where: { id: alertLog.id },
      data: {
        status: alertResult.success ? MessageStatus.SUCCESS : MessageStatus.FAILED,
        response: alertResult.response as any,
        errorMessage: sanitizeErrorMessage(alertResult.errorMessage),
        durationMs: Date.now() - alertStarted,
        attempts: 1,
      },
    });
    await this.publish(alertLog.id);
  }

  private async checkFailRateAlert(projectId: string) {
    try {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return;
      const threshold = project.alertFailRatePct;
      if (threshold == null || threshold <= 0) return;

      const windowMin = project.alertWindowMin || 60;
      const since = new Date(Date.now() - windowMin * 60 * 1000);
      if (project.lastFailAlertAt && project.lastFailAlertAt > since) return;

      const [total, failed] = await Promise.all([
        this.prisma.messageLog.count({
          where: {
            projectId,
            createdAt: { gte: since },
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
        this.prisma.messageLog.count({
          where: {
            projectId,
            createdAt: { gte: since },
            status: MessageStatus.FAILED,
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
      ]);
      if (total <= 0) return;
      const rate = (failed / total) * 100;
      if (rate < threshold) return;

      const backup = await this.channels.resolveBackupChannel(projectId);
      if (backup && backup.type !== ChannelType.SMTP) {
        const title = `【失败率告警】${project.name}`;
        const content = [
          `项目: ${project.name}`,
          `窗口: 近 ${windowMin} 分钟`,
          `失败率: ${rate.toFixed(1)}% (${failed}/${total})`,
          `阈值: ${threshold}%`,
          `时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        ].join('\n');
        await this.sendBackupPush(projectId, backup, title, content);
      }

      await this.prisma.project.update({
        where: { id: projectId },
        data: { lastFailAlertAt: new Date() },
      });
      this.logger.log(
        `fail-rate alert project=${projectId} rate=${rate.toFixed(1)}% threshold=${threshold}`,
      );
    } catch (e: any) {
      this.logger.warn(`fail-rate alert failed: ${e?.message || e}`);
    }
  }

  async process(job: Job<SendJobData>) {
    const data = job.data;
    const existing = await this.prisma.messageLog.findUnique({ where: { id: data.messageId } });
    if (!existing || existing.status === MessageStatus.SUCCESS || existing.status === MessageStatus.FAILED) return { success: existing?.status === MessageStatus.SUCCESS, skipped: true };
    if ((existing as any).deliveryStartedAt) {
      await this.prisma.messageLog.updateMany({ where: { id: data.messageId, status: MessageStatus.PENDING }, data: { status: MessageStatus.FAILED, errorMessage: 'DELIVERY_UNKNOWN: 上次外部发送结果未知，请核实后手动重发', nextRetryAt: null } });
      await this.publish(data.messageId);
      return { success: false, uncertain: true };
    }
    if (data.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: data.projectId }, select: { enabled: true } });
      if (!project?.enabled) {
        await this.prisma.messageLog.updateMany({ where: { id: data.messageId, status: MessageStatus.PENDING }, data: { status: MessageStatus.FAILED, errorMessage: '项目不存在或已禁用', nextRetryAt: null } });
        await this.publish(data.messageId);
        return { success: false, skipped: true };
      }
    }
    const channel = await this.prisma.channel.findUnique({ where: { id: data.channelId } });
    if (!channel || !channel.enabled) {
      await this.prisma.messageLog.update({
        where: { id: data.messageId },
        data: {
          status: MessageStatus.FAILED,
          errorMessage: '渠道不存在或已禁用',
          attempts: job.attemptsMade + 1,
        },
      });
      await this.publish(data.messageId);
      if (data.projectId) {
        await this.checkFailRateAlert(data.projectId);
      }
      return { success: false };
    }

    const config = (channel.config || {}) as Record<string, unknown>;
    // 推送补齐 messageId/readToken（队列 payload 可能在入库后注入过）
    let sendPayload: any = data.payload || {};
    if (data.kind === 'push') {
      const extra = { ...(sendPayload.extra || {}) };
      if (!extra.messageId) extra.messageId = data.messageId;
      try {
        const { resolveUnsubscribeSecret, signReadToken } = await import(
          '../common/token.util'
        );
        if (!extra.readToken) {
          const secret = resolveUnsubscribeSecret(
            process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET,
            { allowDevFallback: true },
          );
          extra.readToken = signReadToken(data.messageId, secret);
        }
      } catch {
        /* ignore */
      }
      sendPayload = { ...sendPayload, extra };
    }
    const started = Date.now();
    const claimed = await this.prisma.messageLog.updateMany({
      where: { id: data.messageId, status: MessageStatus.PENDING, deliveryStartedAt: null } as any,
      data: { deliveryStartedAt: new Date() } as any,
    });
    if (!claimed.count) return { success: false, skipped: true };
    const result = await safeAdapterSend(this.adapters, channel.type, config, sendPayload);
    const durationMs = Date.now() - started;

    if (result.success && data.kind === 'push' && data.projectId) {
      // 异步成功后也登记未读邮件兜底
      try {
        const log = await this.prisma.messageLog.findUnique({
          where: { id: data.messageId },
          select: { source: true, title: true, content: true, readAt: true, payload: true },
        });
        if (log && log.source !== MessageSource.BACKUP_ALERT) {
          const project = await this.prisma.project.findUnique({
            where: { id: data.projectId },
          });
          if (project?.unreadEmailFallbackEnabled) {
            // 已读或已邮件兜底：不再创建兜底任务
            const payload = (log.payload || {}) as any;
            const emailFb = payload?.emailFallback;
            if (!log.readAt && !(emailFb && typeof emailFb === 'object')) {
              const minutes = Math.max(
                1,
                Math.min(43200, Number(project.unreadEmailFallbackHours) || 24),
              );
              const runAt = new Date(Date.now() + minutes * 60 * 1000);
              const existing = await this.prisma.scheduledMessage.findFirst({
                where: {
                  projectId: data.projectId,
                  kind: 'unread_email_fallback',
                  status: 'PENDING',
                  messageId: data.messageId,
                },
              });
              if (!existing) {
                await this.prisma.scheduledMessage.create({
                  data: {
                    id: `unread-${data.messageId}`,
                    projectId: data.projectId,
                    kind: 'unread_email_fallback',
                    title: log.title,
                    content: log.content,
                    templateCode: project.unreadEmailTemplateCode || null,
                    variables: {
                      sourceMessageId: data.messageId,
                      unreadEmailFallback: true,
                      minutes,
                      scheduledAt: new Date().toISOString(),
                      runAt: runAt.toISOString(),
                    } as any,
                    runAt,
                    status: 'PENDING',
                    messageId: data.messageId,
                  },
                });
              }
            }
          }
        }
      } catch (e: any) {
        this.logger.warn(`unread fallback schedule failed: ${e?.message || e}`);
      }
    }

    if (!result.success) {
      const attempts = job.attemptsMade + 1;
      const max = job.opts.attempts || 1;
      const isLast = attempts >= max;
      const prev = await this.prisma.messageLog.findUnique({
        where: { id: data.messageId },
        select: { attemptDetail: true },
      });
      const detail = Array.isArray(prev?.attemptDetail)
        ? [...(prev!.attemptDetail as any[])]
        : [];
      detail.push({
        n: attempts,
        at: new Date().toISOString(),
        status: isLast ? 'FAILED' : 'RETRY',
        error: sanitizeErrorMessage(result.errorMessage),
        durationMs,
      });
      const nextRetryAt = isLast
        ? null
        : new Date(Date.now() + Math.min(60_000, 2000 * Math.pow(2, attempts - 1)));
      await this.prisma.messageLog.update({
        where: { id: data.messageId },
        data: {
          status: isLast ? MessageStatus.FAILED : MessageStatus.PENDING,
          response: result.response as any,
          errorMessage: sanitizeErrorMessage(result.errorMessage),
          durationMs,
          attempts,
          attemptDetail: detail.slice(-20) as any,
          nextRetryAt,
          deliveryStartedAt: null,
        } as any,
      });
      await this.publish(data.messageId);
      this.logger.warn(`send failed message=${data.messageId} attempt=${attempts}: ${result.errorMessage}`);

      if (isLast) {
        const log = await this.prisma.messageLog.findUnique({ where: { id: data.messageId } });
        if (log && log.source !== MessageSource.BACKUP_ALERT && log.projectId) {
          // 1) 原消息按顺序兜底到其它已启用渠道
          if (data.kind === 'push') {
            try {
              const payload: any = data.payload || {};
              const tried = Array.from(
                new Set(
                  [
                    ...((payload._failover?.triedChannelIds as string[]) || []),
                    data.channelId,
                    log.channelId || '',
                  ].filter(Boolean),
                ),
              );
              const candidates = await this.channels.listFailoverChannels(
                log.projectId,
                tried,
              );
              for (const ch of candidates) {
                this.logger.log(
                  `failover try parent=${log.id} channel=${ch.id}/${ch.type}`,
                );
                const foLog = await this.prisma.messageLog.create({
                  data: {
                    projectId: log.projectId,
                    channelId: ch.id,
                    channelType: ch.type,
                    source: log.source,
                    status: MessageStatus.PENDING,
                    title: payload.title || log.title,
                    content: payload.content || log.content,
                    payload: {
                      title: payload.title || log.title,
                      content: payload.content || log.content,
                      html: payload.html,
                      to: payload.to,
                      extra: {
                        ...(payload.extra || {}),
                        failoverFrom: log.id,
                      },
                    } as any,
                    toAddress: payload.to || log.toAddress,
                    templateCode: log.templateCode,
                    parentId: log.id,
                    priority: log.priority,
                    eventCode: log.eventCode,
                    dedupeKey: log.dedupeKey,
                    attempts: 0,
                  },
                });
                const foCfg = (ch.config || {}) as Record<string, unknown>;
                const foStarted = Date.now();
                const { resolveUnsubscribeSecret, signReadToken } = await import('../common/token.util');
                const foExtra = { ...(payload.extra || {}), messageId: foLog.id, readToken: signReadToken(foLog.id, resolveUnsubscribeSecret(process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET, { allowDevFallback: true })) };
                await this.prisma.messageLog.update({ where: { id: foLog.id }, data: {
                  deliveryStartedAt: new Date(),
                  payload: { title: payload.title || log.title, content: payload.content || log.content, html: payload.html, to: payload.to || log.toAddress, extra: { ...foExtra, failoverFrom: log.id } } as any,
                } });
                const foResult = await safeAdapterSend(this.adapters, ch.type, foCfg, {
                  title: payload.title || log.title || undefined,
                  content: payload.content || log.content || undefined,
                  html: payload.html,
                  to: payload.to || log.toAddress || undefined,
                  extra: foExtra,
                });
                await this.prisma.messageLog.update({
                  where: { id: foLog.id },
                  data: {
                    status: foResult.success
                      ? MessageStatus.SUCCESS
                      : MessageStatus.FAILED,
                    response: foResult.response as any,
                    errorMessage: sanitizeErrorMessage(foResult.errorMessage),
                    durationMs: Date.now() - foStarted,
                    attempts: 1,
                    deliveryStartedAt: null,
                  } as any,
                });
                await this.publish(foLog.id);
                if (foResult.success) {
                  await this.scheduleFailoverFallback(log.projectId, foLog.id, payload.title || log.title, payload.content || log.content);
                  this.logger.log(
                    `failover success parent=${log.id} via=${ch.id} message=${foLog.id}`,
                  );
                  break; // 一条兜底成功即可
                }
              }
            } catch (e: any) {
              this.logger.warn(`failover failed: ${e?.message || e}`);
            }
          }

          // 2) 失败告警文案 → 备用渠道（不是原消息）
          try {
            const cooled = await this.emailPolicy.shouldSkipBackupAlert(log.projectId, {
              toAddress: log.toAddress,
              errorMessage: result.errorMessage,
            });
            if (!cooled) {
              const backup = await this.channels.resolveBackupChannel(
                log.projectId,
                log.channelId || undefined,
              );
              if (backup && backup.type !== ChannelType.SMTP) {
                const isEmail =
                  data.kind === 'email' || log.channelType === ChannelType.SMTP;
                const title = isEmail
                  ? `【邮件发送失败】${log.title || '邮件'}`
                  : `【发送失败告警】${log.title || '消息'}`;
                const content = [
                  `原消息 ID: ${log.id}`,
                  `原渠道: ${log.channelType || '-'}`,
                  log.toAddress ? `收件人: ${log.toAddress}` : null,
                  log.title ? `主题: ${log.title}` : null,
                  log.source ? `来源: ${log.source}` : null,
                  isEmail ? '类型: email' : data.kind ? `类型: ${data.kind}` : null,
                  `错误: ${result.errorMessage || '未知错误'}`,
                  `时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
                ]
                  .filter(Boolean)
                  .join('\n');
                await this.sendBackupPush(log.projectId, backup, title, content, log.id);
              }
            } else {
              this.logger.log(`backup alert cooled-down skip message=${log.id}`);
            }
          } catch (e: any) {
            this.logger.warn(`backup alert failed: ${e?.message || e}`);
          }
          if (data.kind === 'email' || log.channelType === ChannelType.SMTP) {
            try {
              await this.emailPolicy.maybeAutoSuppress(
                log.projectId,
                log.toAddress,
                result.errorMessage,
              );
            } catch (e: any) {
              this.logger.warn(`auto suppress failed: ${e?.message || e}`);
            }
          }
          try {
            await this.checkFailRateAlert(log.projectId);
          } catch (e: any) {
            this.logger.warn(`fail-rate alert failed: ${e?.message || e}`);
          }
        }
      }

      throw new Error(result.errorMessage || '发送失败');
    }

    await this.prisma.messageLog.update({
      where: { id: data.messageId },
      data: {
        status: MessageStatus.SUCCESS,
        response: result.response as any,
        errorMessage: null,
        durationMs,
        attempts: job.attemptsMade + 1,
        nextRetryAt: null,
        deliveryStartedAt: null,
        attemptDetail: [
          ...((await this.prisma.messageLog
            .findUnique({
              where: { id: data.messageId },
              select: { attemptDetail: true },
            })
            .then((r) => (Array.isArray(r?.attemptDetail) ? r!.attemptDetail : []))) as any[]),
          {
            n: job.attemptsMade + 1,
            at: new Date().toISOString(),
            status: 'SUCCESS',
            durationMs,
          },
        ].slice(-20) as any,
      } as any,
    });
    await this.publish(data.messageId);
    return { success: true };
  }

  private async scheduleFailoverFallback(projectId: string, messageId: string, title?: string | null, content?: string | null) {
    try {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project?.unreadEmailFallbackEnabled) return;
      const source = await this.prisma.messageLog.findUnique({ where: { id: messageId }, select: { readAt: true } });
      if (!source || source.readAt) return;
      const minutes = Math.max(1, Math.min(43200, Number(project.unreadEmailFallbackHours) || 24));
      await this.prisma.scheduledMessage.upsert({
        where: { id: `unread-${messageId}` }, update: {},
        create: { id: `unread-${messageId}`, projectId, messageId, kind: 'unread_email_fallback', title, content,
          templateCode: project.unreadEmailTemplateCode, runAt: new Date(Date.now() + minutes * 60_000),
          variables: { sourceMessageId: messageId, unreadEmailFallback: true, minutes }, status: 'PENDING' },
      });
    } catch (e: any) { this.logger.warn(`failover unread fallback schedule: ${e?.message}`); }
  }
}
