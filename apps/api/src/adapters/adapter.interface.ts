import { ChannelType } from '@prisma/client';

export interface SendPayload {
  title?: string;
  content?: string;
  html?: string;
  to?: string;
  extra?: Record<string, unknown>;
}

export interface SendResult {
  success: boolean;
  response?: unknown;
  errorMessage?: string;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  validateConfig(config: Record<string, unknown>): void;
  send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult>;
  test(config: Record<string, unknown>): Promise<SendResult>;
}

export function requireString(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`配置缺少必填字段: ${key}`);
  }
  return v.trim();
}
