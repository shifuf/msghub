import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { ChannelAdapter } from './adapter.interface';
import { ServerChanAdapter } from './serverchan.adapter';
import { PushPlusAdapter } from './pushplus.adapter';
import { DingTalkAdapter } from './dingtalk.adapter';
import { TelegramAdapter } from './telegram.adapter';
import { WebhookAdapter } from './webhook.adapter';
import { SmtpAdapter } from './smtp.adapter';
import { InboxAdapter } from './inbox.adapter';
import { BarkAdapter } from './bark.adapter';
import { GotifyAdapter } from './gotify.adapter';
import { FeishuAdapter } from './feishu.adapter';
import { DiscordAdapter } from './discord.adapter';
import { JpushAdapter } from './jpush.adapter';

@Injectable()
export class AdapterRegistry {
  private readonly map = new Map<ChannelType, ChannelAdapter>();

  constructor(
    serverchan: ServerChanAdapter,
    pushplus: PushPlusAdapter,
    dingtalk: DingTalkAdapter,
    telegram: TelegramAdapter,
    webhook: WebhookAdapter,
    smtp: SmtpAdapter,
    inbox: InboxAdapter,
    bark: BarkAdapter,
    gotify: GotifyAdapter,
    feishu: FeishuAdapter,
    discord: DiscordAdapter,
    jpush: JpushAdapter,
  ) {
    for (const a of [
      serverchan,
      pushplus,
      dingtalk,
      telegram,
      webhook,
      smtp,
      inbox,
      bark,
      gotify,
      feishu,
      discord,
      jpush,
    ]) {
      this.map.set(a.type, a);
    }
  }

  get(type: ChannelType): ChannelAdapter {
    const adapter = this.map.get(type);
    if (!adapter) throw new Error(`不支持的渠道类型: ${type}`);
    return adapter;
  }

  list(): ChannelType[] {
    return [...this.map.keys()];
  }
}
