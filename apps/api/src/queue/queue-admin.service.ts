import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SEND_QUEUE, SendJobData } from './queue.constants';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QueueAdminService {
  private readonly logger = new Logger(QueueAdminService.name);

  constructor(@InjectQueue(SEND_QUEUE) private sendQueue: Queue<SendJobData>, private prisma: PrismaService) {}

  async stats() {
    try {
      const counts = await this.sendQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      );
      return {
        name: SEND_QUEUE,
        counts,
        isPaused: await this.sendQueue.isPaused(),
      };
    } catch (e: any) {
      this.logger.warn(`queue stats failed: ${e?.message || e}`);
      return {
        name: SEND_QUEUE,
        counts: null,
        error: e?.message || String(e),
      };
    }
  }

  async listFailed(limit = 50) {
    const take = Math.min(200, Math.max(1, limit));
    try {
      const jobs = await this.sendQueue.getFailed(0, take - 1);
      return jobs.map((j) => ({
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason,
        timestamp: j.timestamp,
        finishedOn: j.finishedOn,
        data: {
          messageId: j.data?.messageId,
          kind: j.data?.kind,
          projectId: j.data?.projectId,
          channelId: j.data?.channelId,
          channelType: j.data?.channelType,
        },
      }));
    } catch (e: any) {
      return { error: e?.message || String(e), items: [] };
    }
  }

  async listDelayed(limit = 50) {
    const take = Math.min(200, Math.max(1, limit));
    try {
      const jobs = await this.sendQueue.getDelayed(0, take - 1);
      return jobs.map((j) => ({
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
        timestamp: j.timestamp,
        delay: j.opts?.delay,
        data: {
          messageId: j.data?.messageId,
          kind: j.data?.kind,
          projectId: j.data?.projectId,
          channelId: j.data?.channelId,
        },
      }));
    } catch (e: any) {
      return { error: e?.message || String(e), items: [] };
    }
  }

  async retryFailed(jobId: string) {
    const job = await this.sendQueue.getJob(jobId);
    if (!job) throw new NotFoundException('任务不存在');
    if (await job.getState() !== 'failed') throw new BadRequestException('仅失败队列任务可重试');
    const changed = await this.prisma.messageLog.updateMany({
      where: { id: job.data.messageId, status: 'FAILED', deliveryStartedAt: null,
        OR: [{ errorMessage: null }, { NOT: { errorMessage: { startsWith: 'DELIVERY_UNKNOWN:' } } }] },
      data: { status: 'PENDING', nextRetryAt: null },
    });
    if (!changed.count) throw new BadRequestException('仅明确失败的消息可重试；结果未知请先核实并显式重新发送');
    try { await job.retry(); }
    catch (error: any) {
      // Redis may have accepted retry before the reply was lost, or a concurrent
      // removal may have won. Preserve PENDING for the stable-ID recovery loop;
      // resetting FAILED would make an already queued worker skip the message.
      this.logger.warn(`retry acknowledgement unavailable job=${jobId}: ${error?.message}`);
      return { id: jobId, retried: false, recoveryPending: true };
    }
    return { id: jobId, retried: true };
  }

  async removeFailed(jobId: string) {
    const job = await this.sendQueue.getJob(jobId);
    if (!job) throw new NotFoundException('任务不存在');
    if (await job.getState() !== 'failed') throw new BadRequestException('仅失败队列任务可删除');
    // BullMQ atomically refuses locked active jobs. If retry moves a job to
    // waiting after this check, removal still leaves its PENDING database row
    // intact so recoverPending can recreate send-${messageId} safely.
    await job.remove();
    return { id: jobId, removed: true };
  }
}
