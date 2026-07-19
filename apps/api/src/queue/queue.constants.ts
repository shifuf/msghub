export const SEND_QUEUE = 'message-send';
export type SendJobKind = 'push' | 'email';

export interface SendJobData {
  messageId: string;
  kind: SendJobKind;
  projectId: string;
  channelId: string;
  channelType: string;
  payload: {
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    extra?: Record<string, unknown>;
    _failover?: {
      triedChannelIds: string[];
      kind: SendJobKind;
    };
  };
}
