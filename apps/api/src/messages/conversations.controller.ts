import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { ConversationAccessDto, ConversationHistoryQueryDto, ConversationInboxQueryDto, ConversationReplyDto, PublicConversationReplyDto, UpdateConversationDto } from './conversation.dto';
import { ConversationsService } from './conversations.service';

@Controller('public/messages')
export class PublicConversationsController {
  constructor(private conversations: ConversationsService) {}

  @Post('conversation')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async get(@Body() dto: ConversationAccessDto) { return ok(await this.conversations.getPublic(dto.messageId, dto.token)); }

  @Post('reply')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async reply(@Body() dto: PublicConversationReplyDto) { return ok(await this.conversations.replyPublic(dto.messageId, dto.token, dto)); }
}

@UseGuards(JwtAuthGuard)
@Controller(['messages', 'admin/messages'])
export class AdminConversationsController {
  constructor(private conversations: ConversationsService) {}

  @Get(':id/conversation')
  @Header('Cache-Control', 'no-store')
  async get(@Param('id') id: string, @Query() query: ConversationHistoryQueryDto) { return ok(await this.conversations.getAdmin(id, query)); }

  @Post(':id/reply')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async reply(@Param('id') id: string, @Body() dto: ConversationReplyDto) { return ok(await this.conversations.replyAdmin(id, dto)); }
}

@UseGuards(JwtAuthGuard)
@Controller('admin/conversations')
export class AdminConversationInboxController {
  constructor(private conversations: ConversationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Query() query: ConversationInboxQueryDto) { return ok(await this.conversations.list(query)); }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  async update(@Param('id') id: string, @Body() dto: UpdateConversationDto) { return ok(await this.conversations.update(id, dto)); }
}
