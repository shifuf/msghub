import { BadRequestException } from '@nestjs/common';

export const SCHEDULE_RULES = ['daily', 'weekly', 'weekdays'] as const;
export const DEFAULT_SCHEDULE_TIMEZONE = 'Asia/Shanghai';

export function validateScheduleRule(cron?: string | null) {
  if (cron && !SCHEDULE_RULES.includes(cron as any)) throw new BadRequestException('重复规则仅支持 daily、weekly、weekdays');
}

export function validateScheduleTimezone(timezone: string = DEFAULT_SCHEDULE_TIMEZONE) {
  if (typeof timezone !== 'string' || !timezone || timezone.length > 100) throw new BadRequestException('任务时区无效');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { throw new BadRequestException('任务时区无效'); }
  return timezone;
}

function localParts(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return [Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)];
}

function localTimestamp(date: Date, formatter: Intl.DateTimeFormat) {
  const [year, month, day, hour, minute, second] = localParts(date, formatter);
  return Date.UTC(year, month, day, hour, minute, second);
}

/** One occurrence per local calendar date; nonexistent DST times are skipped. */
export function nextScheduleRun(runAt: Date, cron: string, timezone = DEFAULT_SCHEDULE_TIMEZONE, now = new Date()): Date {
  validateScheduleRule(cron);
  validateScheduleTimezone(timezone);
  if (!Number.isFinite(runAt.getTime()) || !Number.isFinite(now.getTime())) throw new BadRequestException('执行时间无效');
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const [year, month, day, hour, minute, second] = localParts(runAt, formatter);
  const anchorDate = Date.UTC(year, month, day);
  const today = new Date(localTimestamp(now, formatter));
  const currentDate = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const earliest = Math.max(runAt.getTime(), now.getTime());
  const weekday = new Date(anchorDate).getUTCDay();
  const dayMs = 86400000;
  for (let localDay = Math.max(anchorDate + dayMs, currentDate), steps = 0; steps < 370; localDay += dayMs, steps++) {
    const dayOfWeek = new Date(localDay).getUTCDay();
    if (cron === 'weekly' && dayOfWeek !== weekday) continue;
    if (cron === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) continue;
    const target = localDay + hour * 3600000 + minute * 60000 + second * 1000;
    const offsets = new Set<number>();
    for (const delta of [-48, -24, -12, 0, 12, 24, 48]) {
      const probe = new Date(target + delta * 3600000);
      offsets.add(localTimestamp(probe, formatter) - probe.getTime());
    }
    const candidates = [...offsets].map(offset => target - offset + runAt.getUTCMilliseconds())
      .filter(candidate => localTimestamp(new Date(candidate), formatter) === target).sort((a, b) => a - b);
    // A repeated DST wall time always uses its first occurrence.
    if (candidates.length && candidates[0] > earliest) return new Date(candidates[0]);
  }
  throw new BadRequestException('无法计算下次执行时间');
}
