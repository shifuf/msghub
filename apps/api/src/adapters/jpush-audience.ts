export type JpushAudience = 'all' | { registration_id: string[] } | { alias: string[] };

export function isJpushRegistrationIdTarget(target: unknown, registrationId: string): boolean {
  if (!registrationId || !target || typeof target !== 'object' || Array.isArray(target)) return false;
  const values = (target as Record<string, unknown>).registration_id;
  return Array.isArray(values) && values.some(value => typeof value === 'string' && value === registrationId);
}

function split(value: unknown): string[] {
  return typeof value === 'string' ? [...new Set(value.trim().split(/[,;\s]+/).filter(Boolean))] : [];
}

export function resolveJpushAudience(config: Record<string, unknown>, extra: Record<string, unknown>): JpushAudience {
  // Once accepted for sending, keep the original audience even if the channel changes.
  const saved = extra._jpushAudience;
  if (saved === 'all') return 'all';
  if (saved && typeof saved === 'object') {
    for (const key of ['registration_id', 'alias'] as const) {
      const values = (saved as Record<string, unknown>)[key];
      if (Array.isArray(values) && values.length && values.every(v => typeof v === 'string' && v.trim())) {
        return { [key]: values } as JpushAudience;
      }
    }
    throw new Error('JPUSH 原始目标无效');
  }
  const rid = split(extra.registrationId);
  if (rid.length) return { registration_id: rid };
  const alias = split(extra.alias);
  if (alias.length) return { alias };
  const mode = String(config.audienceMode || 'registration_id').trim().toLowerCase();
  if (mode === 'all') return 'all';
  if (mode === 'alias') {
    const values = split(config.alias);
    if (!values.length) throw new Error('JPUSH alias 为空');
    return { alias: values };
  }
  const values = split(config.registrationId);
  if (!values.length) throw new Error('JPUSH registrationId 为空');
  return { registration_id: values };
}

/** Called at the trusted send boundary; ignore caller-supplied internal routing fields. */
export function snapshotJpushTarget(config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const clean = { ...extra };
  delete clean._jpushAudience;
  delete clean._jpushAppKey;
  return { ...clean, _jpushAudience: resolveJpushAudience(config, clean), _jpushAppKey: config.appKey };
}

export function withoutConversationToken(extra: Record<string, unknown>) {
  const clean = { ...extra };
  delete clean.conversationToken;
  delete clean.receivedToken;
  delete clean.receivedTokens;
  return clean;
}
