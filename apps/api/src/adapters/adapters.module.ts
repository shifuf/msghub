import { Module } from '@nestjs/common';
import { AdapterRegistry } from './adapters.registry';
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

@Module({
  providers: [
    ServerChanAdapter,
    PushPlusAdapter,
    DingTalkAdapter,
    TelegramAdapter,
    WebhookAdapter,
    SmtpAdapter,
    InboxAdapter,
    BarkAdapter,
    GotifyAdapter,
    FeishuAdapter,
    DiscordAdapter,
    JpushAdapter,
    AdapterRegistry,
  ],
  exports: [AdapterRegistry],
})
export class AdaptersModule {}
