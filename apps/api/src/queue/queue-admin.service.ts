import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SEND_QUEUE, SendJobData } from './queue.constants';

@Injectable()
export class QueueAdminService {
  private readonly logger = new Logger(QueueAdminService.name);

  constructor(@InjectQueue(SEND_QUEUE) private sendQueue: Queue<SendJobData>) {}

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
    await job.retry();
    return { id: jobId, retried: true };
  }

  async removeFailed(jobId: string) {
    const job = await this.sendQueue.getJob(jobId);
    if (!job) throw new NotFoundException('任务不存在');
    await job.remove();
    return { id: jobId, removed: true };
  }
}
