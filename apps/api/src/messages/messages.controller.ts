import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ChannelType, MessagePriority, MessageStatus } from '@prisma/client';
import { Response } from 'express';
import { MessagesService } from './messages.service';
import {
  AdminSendDto,
  BatchResendDto,
  BatchSendDto,
  ClearMessagesDto,
  IdsDto,
  CleanupDto,
} from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@UseGuards(JwtAuthGuard)
@Controller('admin/messages')
export class MessagesController {
  constructor(private messages: MessagesService) {}

  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('status') status?: MessageStatus,
    @Query('channelType') channelType?: ChannelType,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('hasError') hasError?: string,
    @Query('toAddress') toAddress?: string,
    @Query('onlySmtpFailed') onlySmtpFailed?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('archived') archived?: string,
    @Query('eventCode') eventCode?: string,
    @Query('priority') priority?: MessagePriority,
  ) {
    return ok(
      await this.messages.list({
        projectId,
        status,
        channelType,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
        q,
        from,
        to,
        toAddress,
        eventCode,
        priority,
        onlySmtpFailed:
          onlySmtpFailed === undefined
            ? undefined
            : onlySmtpFailed === 'true' || onlySmtpFailed === '1',
        hasError:
          hasError === undefined
            ? undefined
            : hasError === 'true' || hasError === '1',
        unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
        archived:
          archived === 'only'
            ? 'only'
            : archived === 'exclude' || archived === 'false'
              ? 'exclude'
              : archived === 'true' || archived === '1'
                ? true
                : undefined,
      }),
    );
  }

  @Get('export')
  async export(
    @Res() res: Response,
    @Query('projectId') projectId?: string,
    @Query('status') status?: MessageStatus,
    @Query('channelType') channelType?: ChannelType,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('hasError') hasError?: string,
    @Query('toAddress') toAddress?: string,
    @Query('onlySmtpFailed') onlySmtpFailed?: string,
  ) {
    const csv = await this.messages.exportCsv({
      projectId,
      status,
      channelType,
      q,
      from,
      to,
      toAddress,
      onlySmtpFailed:
        onlySmtpFailed === undefined
          ? undefined
          : onlySmtpFailed === 'true' || onlySmtpFailed === '1',
      hasError:
        hasError === undefined
          ? undefined
          : hasError === 'true' || hasError === '1',
    });
    const filename = `messages-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  }

  @Post('clear')
  async clear(@Body() dto: ClearMessagesDto) {
    return ok(await this.messages.clear(dto || {}));
  }

  /** 设备推送历史（按 Registration ID） */
  @Get('device-history')
  async deviceHistory(
    @Query('registrationId') registrationId?: string,
    @Query('projectId') projectId?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
  ) {
    return ok(
      await this.messages.listDevicePushHistory({
        registrationId,
        projectId,
        unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
        q,
      }),
    );
  }

  @Post('mark-read')
  async markRead(@Body() dto: IdsDto) {
    return ok(await this.messages.markRead(dto.ids || []));
  }

  @Post('archive')
  async archive(@Body() dto: IdsDto & { archived?: boolean }) {
    return ok(await this.messages.archive(dto.ids || [], dto.archived !== false));
  }

  @Post('cleanup')
  async cleanup(@Body() dto: CleanupDto) {
    return ok(await this.messages.cleanup(dto || {}));
  }

  @Post('send')
  async send(@Body() dto: AdminSendDto) {
    return ok(await this.messages.adminSend(dto));
  }

  @Post('batch')
  async batch(@Body() dto: BatchSendDto) {
    return ok(await this.messages.batchSend(dto));
  }

  @Post('batch-resend')
  async batchResend(@Body() dto: BatchResendDto) {
    return ok(await this.messages.batchResend(dto || {}));
  }

  @Post(':id/resend')
  async resend(@Param('id') id: string) {
    return ok(await this.messages.resend(id));
  }

  @Post(':id/resend-unread')
  async resendUnread(@Param('id') id: string) {
    return ok(await this.messages.resendUnreadPush(id));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return ok(await this.messages.get(id));
  }
}

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class MessagesExtraController {
  constructor(private messages: MessagesService) {}

  @Get('recipients/timeline')
  async timeline(
    @Query('address') address: string,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: string,
  ) {
    return ok(
      await this.messages.recipientTimeline({
        address,
        projectId,
        limit: limit ? Number(limit) : 50,
      }),
    );
  }

  @Post('projects/:id/simulate-send')
  async simulate(
    @Param('id') id: string,
    @Body() body: { title?: string; content?: string; channelIds?: string[] },
  ) {
    return ok(await this.messages.simulateSend(id, body || {}));
  }
}
