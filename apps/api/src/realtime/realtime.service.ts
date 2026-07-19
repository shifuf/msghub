import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, map } from 'rxjs';

export type RealtimeEvent = {
  type: 'message' | 'stats' | 'ping' | 'ready';
  data: any;
  at: string;
};

@Injectable()
export class RealtimeService {
  private readonly bus = new Subject<RealtimeEvent>();

  emit(type: RealtimeEvent['type'], data: any) {
    this.bus.next({
      type,
      data,
      at: new Date().toISOString(),
    });
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
