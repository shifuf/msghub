import { AdapterRegistry } from '../adapters/adapters.registry';
import { ChannelType } from '@prisma/client';
import { SendPayload, SendResult } from '../adapters/adapter.interface';
import { sanitizeErrorMessage } from './utils';

export class DeliveryUncertainError extends Error {
  constructor(public readonly messageId: string) { super(`DELIVERY_UNKNOWN: ${messageId} 外部送达结果待核实`); }
}

/** Keep adapter/config exceptions inside the attempt boundary. */
export async function safeAdapterSend(
  adapters: AdapterRegistry,
  type: ChannelType,
  config: Record<string, unknown>,
  payload: SendPayload,
): Promise<SendResult> {
  try {
    return await adapters.get(type).send(config, payload);
  } catch (error: any) {
    return { success: false, errorMessage: sanitizeErrorMessage(error?.message || String(error)) || '发送异常' };
  }
}
