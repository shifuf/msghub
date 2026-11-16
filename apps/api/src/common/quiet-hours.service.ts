import { Injectable } from '@nestjs/common';
import { MessagePriority } from '@prisma/client';

export type QuietProject = {
  quietHoursEnabled?: boolean | null;
  quietStart?: string | null;
  quietEnd?: string | null;
  quietTimezone?: string | null;
};

@Injectable()
export class QuietHoursService {
  isQuiet(project: QuietProject, at = new Date()): boolean {
    if (!project?.quietHoursEnabled) return false;
    const start = (project.quietStart || '').trim();
    const end = (project.quietEnd || '').trim();
    if (!start || !end) return false;
    const tz = project.quietTimezone || 'Asia/Shanghai';
    const minutes = this.localMinutes(at, tz);
    const startM = this.parseHm(start);
    const endM = this.parseHm(end);
    if (startM == null || endM == null) return false;
    if (startM === endM) return false;
    // 跨午夜：22:00-08:00 → minutes >= 22:00 || minutes < 08:00
    if (startM > endM) return minutes >= startM || minutes < endM;
    return minutes >= startM && minutes < endM;
  }

  shouldHold(project: QuietProject, priority: MessagePriority | string | undefined, at = new Date()) {
    const p = String(priority || 'NORMAL').toUpperCase();
    if (p === 'HIGH' || p === 'CRITICAL') return false;
    return this.isQuiet(project, at);
  }

  /** 下一次 quietEnd 的绝对时间（本地时区） */
  nextQuietEnd(project: QuietProject, at = new Date()): Date {
    const end = (project.quietEnd || '08:00').trim();
    const tz = project.quietTimezone || 'Asia/Shanghai';
    const endM = this.parseHm(end) ?? 8 * 60;
    const local = this.localParts(at, tz);
    let target = new Date(at);
    // 构造「今天 end」在 UTC 的近似：用 offset
    const candidate = this.zonedTimeToUtc(
      {
        year: local.year,
        month: local.month,
        day: local.day,
        hour: Math.floor(endM / 60),
        minute: endM % 60,
      },
      tz,
    );
    if (candidate.getTime() <= at.getTime()) {
      // 明天
      const tomorrow = new Date(at.getTime() + 24 * 60 * 60 * 1000);
      const lp = this.localParts(tomorrow, tz);
      return this.zonedTimeToUtc(
        {
          year: lp.year,
          month: lp.month,
          day: lp.day,
          hour: Math.floor(endM / 60),
          minute: endM % 60,
        },
        tz,
      );
    }
    return candidate;
  }

  parsePriority(raw?: string | null): MessagePriority {
    const v = String(raw || 'normal').toLowerCase();
    if (v === 'low') return MessagePriority.LOW;
    if (v === 'high') return MessagePriority.HIGH;
    if (v === 'critical') return MessagePriority.CRITICAL;
    return MessagePriority.NORMAL;
  }

  private parseHm(s: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  private localMinutes(at: Date, timeZone: string): number {
    const p = this.localParts(at, timeZone);
    return p.hour * 60 + p.minute;
  }

  private localParts(at: Date, timeZone: string) {
    try { new Intl.DateTimeFormat('en-US', { timeZone }).format(at); }
    catch { timeZone = 'Asia/Shanghai'; }
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(at);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value || 0);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
    };
  }

  /** 将某时区墙钟时间转为 UTC Date（无依赖实现） */
  private zonedTimeToUtc(
    parts: { year: number; month: number; day: number; hour: number; minute: number },
    timeZone: string,
  ): Date {
    const utcGuess = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
    );
    // 迭代修正 offset
    let d = new Date(utcGuess);
    for (let i = 0; i < 3; i++) {
      const local = this.localParts(d, timeZone);
      const localAsUtc = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        0,
      );
      const desired = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        0,
      );
      const diff = desired - localAsUtc;
      if (diff === 0) break;
      d = new Date(d.getTime() + diff);
    }
    return d;
  }
}
