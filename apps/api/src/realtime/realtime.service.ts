import { Injectable, MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, map } from 'rxjs';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { resolveRedis } from '../common/env';

export type ConversationEventData = {
  kind: 'reply' | 'read' | 'status';
  messageId: string;
  replyId?: string;
  author?: 'admin' | 'device';
  reader?: 'admin' | 'device';
  count?: number;
  status?: 'open' | 'closed';
  createdAt?: string;
  deliveryStatus?: string;
};

export type RealtimeEvent = {
  type: 'message' | 'conversation' | 'device' | 'stats' | 'ping' | 'ready';
  data: any;
  at: string;
};

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly bus = new Subject<RealtimeEvent>();
  private readonly instanceId = randomUUID();
  private readonly channel = 'msghub:realtime:v1';
  private publisher?: Redis;
  private subscriber?: Redis;

  private createRedis() {
    return new Redis({ ...resolveRedis(), lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: attempt => Math.min(250 * attempt, 5000) });
  }

  async onModuleInit() {
    this.publisher = this.createRedis();
    this.subscriber = this.createRedis();
    this.publisher.on('error', () => undefined);
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('message', (channel, raw) => {
      if (channel !== this.channel || raw.length > 1024 * 1024) return;
      try {
        const envelope = JSON.parse(raw);
        if (envelope.instanceId === this.instanceId || typeof envelope.instanceId !== 'string') return;
        const event = envelope.event;
        if (!event || !['message', 'conversation', 'device', 'stats'].includes(event.type) || typeof event.at !== 'string') return;
        if (event.type === 'conversation' && (!event.data || typeof event.data.messageId !== 'string' || !['reply', 'read', 'status'].includes(event.data.kind))) return;
        this.bus.next(event);
      } catch { /* Ignore malformed envelopes. Clients recover through incremental polling. */ }
    });
    this.subscriber.on('ready', () => { void this.subscriber?.subscribe(this.channel).catch(() => undefined); });
    await Promise.allSettled([this.publisher.connect(), this.subscriber.connect().then(() => this.subscriber!.subscribe(this.channel))]);
  }

  onModuleDestroy() {
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
    this.bus.complete();
  }

  emit(type: RealtimeEvent['type'], data: any) {
    const event: RealtimeEvent = {
      type,
      data,
      at: new Date().toISOString(),
    };
    this.bus.next(event);
    if (this.publisher && (type === 'message' || type === 'conversation' || type === 'device' || type === 'stats')) {
      const payload = JSON.stringify({ instanceId: this.instanceId, event });
      if (Buffer.byteLength(payload) <= 1024 * 1024) void this.publisher.publish(this.channel, payload).catch(() => undefined);
    }
  }

  emitMessage(message: any) {
    this.emit('message', message);
  }

  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({
        type: 'ready',
        data: JSON.stringify({ type: 'ready', at: new Date().toISOString() }),
      } as MessageEvent);

      const sub = this.bus
        .pipe(
          map(
            (ev) =>
              ({
                type: ev.type,
                data: JSON.stringify(ev),
              }) as MessageEvent,
          ),
        )
        .subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
        });

      const timer = setInterval(() => {
        subscriber.next({
          type: 'ping',
          data: JSON.stringify({ type: 'ping', at: new Date().toISOString() }),
        } as MessageEvent);
      }, 15000);

      return () => {
        sub.unsubscribe();
        clearInterval(timer);
      };
    });
  }
}
