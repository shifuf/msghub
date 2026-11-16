import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  UnauthorizedException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { MessageSource } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { MessagesService } from '../messages/messages.service';
import { ProjectsService } from '../projects/projects.service';
import { EmailPolicyService } from '../email-policy/email-policy.service';
import { IdempotencyService } from '../common/idempotency.service';
import { ProjectRateLimitService } from '../common/project-rate-limit.service';
import { TemplatesService } from '../templates/templates.service';
import { isValidEmail, ok } from '../common/utils';

/** Webhook / 通用 JSON */
class WebhookDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  pushTemplate?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  dedupeKey?: string;

  @IsOptional()
  @IsString()
  event?: string;
}

/** Bark 兼容入站体 */
class BarkInboundDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() group?: string;
  @IsOptional() @IsString() sound?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsObject() extra?: Record<string, unknown>;
  @IsOptional() @IsString() pushTemplate?: string;
  @IsOptional() @IsObject() variables?: Record<string, unknown>;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() dedupeKey?: string;
  @IsOptional() @IsString() event?: string;
}

/** Gotify 兼容入站体 */
class GotifyInboundDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() priority?: number | string;
  @IsOptional() @IsObject() extras?: Record<string, unknown>;
  @IsOptional() @IsObject() extra?: Record<string, unknown>;
  @IsOptional() @IsString() pushTemplate?: string;
  @IsOptional() @IsObject() variables?: Record<string, unknown>;
  @IsOptional() @IsString() dedupeKey?: string;
  @IsOptional() @IsString() event?: string;
  /** 业务优先级，避免与 Gotify priority 数字混淆可用 level */
  @IsOptional() @IsString() level?: string;
}

class OpenEmailDto {
  @IsString() to!: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() html?: string;
  @IsOptional() @IsString() template?: string;
  @IsOptional() @IsObject() variables?: Record<string, unknown>;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() dedupeKey?: string;
  @IsOptional() @IsString() event?: string;
}

class BounceDto {
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() type?: string;
}

/**
 * 开放接入（仅项目 API Key）
 */
@Controller()
export class SimplePushController {
  constructor(
    private messages: MessagesService,
    private projects: ProjectsService,
    private emailPolicy: EmailPolicyService,
    private idempotency: IdempotencyService,
    private rateLimit: ProjectRateLimitService,
    private templates: TemplatesService,
  ) {}

  @Post('webhook/dry-run')
  async dryRun(
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: WebhookDto,
  ) {
    const key = this.extractApiKey(apiKeyHeader, authorization);
    if (!key) throw new UnauthorizedException('缺少 API Key');
    const project = await this.projects.findByApiKey(key);
    if (!project || !project.enabled) throw new UnauthorizedException('无效的 API Key');
    await this.assertRateLimit(project);
    return ok(await this.messages.dryRun(project.id, dto));
  }

  /**
   * 开放列出邮件模板（项目模板 + 全局启用模板）。
   * 供博客后台等接入方做模板选择，不返回 htmlBody 大字段。
   */
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('templates')
  async listTemplates(
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const apiKey = this.extractApiKey(apiKeyHeader, authorization);
    if (!apiKey) {
      throw new UnauthorizedException(
        '缺少接口凭证：请在 Header 传 Authorization: Bearer <API Key>',
      );
    }
    const project = await this.projects.findByApiKey(apiKey);
    if (!project) throw new UnauthorizedException('无效的 API Key');
    if (!project.enabled) throw new UnauthorizedException('项目已禁用');
    // 确保博客常用模板已 seed 到全局（幂等）
    await this.templates.seedDefaults(null);
    const rows = await this.templates.list(project.id, true, true);
    return ok(
      rows.map((t) => ({
        code: t.code,
        name: t.name,
        subject: t.subject,
        variables: t.variables || [],
        projectId: t.projectId,
        isSystem: !!t.isSystem,
        enabled: !!t.enabled,
      })),
    );
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('email')
  async email(
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idemHeader: string | undefined,
    @Body() dto: OpenEmailDto,
  ) {
    const apiKey = this.extractApiKey(apiKeyHeader, authorization);
    if (!apiKey) {
      throw new UnauthorizedException(
        '缺少接口凭证：请在 Header 传 Authorization: Bearer <API Key>',
      );
    }
    if (!dto.to?.trim()) throw new BadRequestException('请提供收件人 to');
    if (!isValidEmail(dto.to)) throw new BadRequestException('收件人邮箱格式无效');
    if (!dto.subject && !dto.title && !dto.content && !dto.html && !dto.template && !dto.event) {
      throw new BadRequestException('请提供 subject/title 或 content/html 或 template/event');
    }
    const project = await this.projects.findByApiKey(apiKey);
    if (!project) throw new UnauthorizedException('无效的 API Key');
    if (!project.enabled) throw new UnauthorizedException('项目已禁用');
    await this.assertRateLimit(project);

    const dedupeKey = (idemHeader || dto.dedupeKey || '').trim();
    const ttl = project.idempotencyTtlMin ?? 30;
    let owner: string | undefined;
    if (dedupeKey) {
      const began = await this.idempotency.begin({
        projectId: project.id,
        key: `email:${dedupeKey}`,
        ttlMin: ttl,
      });
      if (began.hit) return ok(began.response);
      owner = (began as any).owner;
      if ((began as any).inFlight) {
        throw new HttpException(
          {
            success: false,
            data: null,
            error: { code: 'IDEMPOTENCY_IN_FLIGHT', message: '相同幂等键请求处理中，请稍后重试' },
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    try {
      let result: any;
      if (dto.event) {
        result = await this.messages.dispatchEvent({
          projectId: project.id,
          source: MessageSource.OPEN_API,
          event: dto.event,
          variables: dto.variables,
          title: dto.subject || dto.title,
          content: dto.content,
          html: dto.html,
          to: dto.to.trim(),
          priority: dto.priority,
          dedupeKey: dedupeKey || undefined,
          forceSync: true,
        });
      } else {
        result = await this.messages.sendEmail({
          projectId: project.id,
          source: MessageSource.OPEN_API,
          to: dto.to.trim(),
          subject: dto.subject || dto.title,
          content: dto.content,
          html: dto.html,
          template: dto.template,
          variables: dto.variables,
          forceSync: true,
          priority: dto.priority,
          dedupeKey: dedupeKey || undefined,
        });
      }

      if (!result.success && result.status !== 'PENDING' && result.status !== 'DELAYED') {
        if (dedupeKey) {
          await this.idempotency.release({ projectId: project.id, key: `email:${dedupeKey}`, owner });
        }
        throw new HttpException(
          {
            success: false,
            data: { messageId: result.messageId, status: result.status },
            error: { code: 'SEND_FAILED', message: result.errorMessage || '发送失败' },
          },
          502,
        );
      }

      const data = {
        messageId: result.messageId,
        status: result.status,
        queued: !!result.queued,
        channelId: result.channelId,
        channelType: result.channelType,
        delayed: !!result.delayed,
        releaseAt: result.releaseAt,
      };
      if (dedupeKey) {
        await this.idempotency.commit({
          projectId: project.id,
          key: `email:${dedupeKey}`,
          messageId: result.messageId,
          response: data,
          ttlMin: ttl,
          owner,
        });
      }
      return ok(data);
    } catch (e: any) {
      // 502 已在上方 release；成功 return 不会进 catch
      if (dedupeKey && e instanceof BadRequestException) {
        try {
          await this.idempotency.release({ projectId: project.id, key: `email:${dedupeKey}`, owner });
        } catch {
          /* ignore */
        }
      }
      if (
        e instanceof BadRequestException ||
        e instanceof UnauthorizedException ||
        e instanceof HttpException
      ) {
        throw e;
      }
      throw new BadRequestException(
        e?.message || '邮件发送失败：请确认项目已绑定并启用 SMTP 渠道',
      );
    }
  }

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Post('bounce')
  async bounce(
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: BounceDto,
  ) {
    const apiKey = this.extractApiKey(apiKeyHeader, authorization);
    if (!apiKey) {
      throw new UnauthorizedException(
        '缺少接口凭证：请在 Header 传 Authorization: Bearer <API Key>',
      );
    }
    const project = await this.projects.findByApiKey(apiKey);
    if (!project) throw new UnauthorizedException('无效的 API Key');
    if (!project.enabled) throw new UnauthorizedException('项目已禁用');

    const email = (dto.email || dto.to || dto.address || '').trim();
    if (!email) throw new BadRequestException('请提供 email/to/address');
    const entry = await this.emailPolicy.addSuppress({
      projectId: project.id,
      address: email,
      source: 'BOUNCE',
      reason: dto.reason || dto.type || 'bounce',
    });
    return ok({ suppressed: true, id: entry.id, address: entry.address });
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('webhook')
  async webhook(
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idemHeader: string | undefined,
    @Body() dto: WebhookDto,
  ) {
    const apiKey = this.extractApiKey(apiKeyHeader, authorization);
    if (!apiKey) {
      throw new UnauthorizedException(
        '缺少接口凭证：请在 Header 传 Authorization: Bearer <API Key>',
      );
    }
    if (!dto.title && !dto.content && !dto.html && !dto.event && !dto.pushTemplate) {
      throw new BadRequestException('请提供 title/content 或 event/pushTemplate');
    }
    return this.dispatch(apiKey, {
      title: dto.title,
      content: dto.content,
      html: dto.html,
      extra: dto.extra,
      pushTemplate: dto.pushTemplate,
      variables: dto.variables,
      priority: dto.priority,
      dedupeKey: idemHeader || dto.dedupeKey,
      event: dto.event,
    });
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('bark')
  async bark(
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idemHeader: string | undefined,
    @Body() dto: BarkInboundDto,
  ) {
    const apiKey = this.extractApiKey(apiKeyHeader, authorization);
    if (!apiKey) {
      throw new UnauthorizedException(
        '缺少接口凭证：请在 Header 传 Authorization: Bearer <API Key>',
      );
    }
    const content = dto.body || dto.content;
    if (!dto.title && !content && !dto.event) {
      throw new BadRequestException('请提供 title 或 body/content 或 event');
    }
    const barkExtra: Record<string, unknown> = { ...(dto.extra || {}) };
    for (const key of ['subtitle', 'group', 'sound', 'icon', 'image', 'url', 'level'] as const) {
      const v = dto[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') barkExtra[key] = v;
    }
    barkExtra.sourceProtocol = 'bark';
    return this.dispatch(apiKey, {
      title: dto.title,
      content,
      extra: barkExtra,
      pushTemplate: dto.pushTemplate,
      variables: dto.variables,
      priority: dto.priority || dto.level,
      dedupeKey: idemHeader || dto.dedupeKey,
      event: dto.event,
    });
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('gotify')
  async gotify(
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idemHeader: string | undefined,
    @Body() dto: GotifyInboundDto,
  ) {
    const apiKey = this.extractApiKey(apiKeyHeader, authorization);
    if (!apiKey) {
      throw new UnauthorizedException(
        '缺少接口凭证：请在 Header 传 Authorization: Bearer <API Key>',
      );
    }
    const content = dto.message || dto.content;
    if (!dto.title && !content && !dto.event) {
      throw new BadRequestException('请提供 title 或 message/content 或 event');
    }
    const gotifyExtra: Record<string, unknown> = { ...(dto.extra || {}) };
    if (dto.priority !== undefined && dto.priority !== null && dto.priority !== '') {
      gotifyExtra.priority = dto.priority;
    }
    if (dto.extras && typeof dto.extras === 'object') {
      gotifyExtra.extras = dto.extras;
    }
    gotifyExtra.sourceProtocol = 'gotify';
    return this.dispatch(apiKey, {
      title: dto.title,
      content,
      extra: gotifyExtra,
      pushTemplate: dto.pushTemplate,
      variables: dto.variables,
      priority: dto.level,
      dedupeKey: idemHeader || dto.dedupeKey,
      event: dto.event,
    });
  }

  private extractApiKey(
    apiKeyHeader?: string,
    authorization?: string,
  ): string | null {
    if (authorization?.startsWith('Bearer ')) {
      const t = authorization.slice(7).trim();
      if (t) return t;
    }
    if (apiKeyHeader?.trim()) return apiKeyHeader.trim();
    return null;
  }

  private async assertRateLimit(project: {
    id: string;
    rateLimitPerMin?: number | null;
  }) {
    const rl = await this.rateLimit.check(project.id, project.rateLimitPerMin);
    if (!rl.allowed) {
      throw new HttpException(
        {
          success: false,
          data: null,
          error: {
            code: 'RATE_LIMITED',
            message: `项目入站限流：每分钟最多 ${rl.limit} 次`,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async dispatch(
    apiKey: string,
    opts: {
      title?: string;
      content?: string;
      html?: string;
      extra?: Record<string, unknown>;
      pushTemplate?: string;
      variables?: Record<string, unknown>;
      priority?: string;
      dedupeKey?: string;
      event?: string;
    },
  ) {
    const project = await this.projects.findByApiKey(apiKey);
    if (!project) throw new UnauthorizedException('无效的 API Key');
    if (!project.enabled) throw new UnauthorizedException('项目已禁用');
    await this.assertRateLimit(project);

    const dedupeKey = (opts.dedupeKey || '').trim();
    const ttl = project.idempotencyTtlMin ?? 30;
    let owner: string | undefined;
    if (dedupeKey) {
      const began = await this.idempotency.begin({
        projectId: project.id,
        key: `push:${dedupeKey}`,
        ttlMin: ttl,
      });
      if (began.hit) return ok(began.response);
      owner = (began as any).owner;
      if ((began as any).inFlight) {
        throw new HttpException(
          {
            success: false,
            data: null,
            error: {
              code: 'IDEMPOTENCY_IN_FLIGHT',
              message: '相同幂等键请求处理中，请稍后重试',
            },
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    try {
      let result: any;
      if (opts.event) {
        result = await this.messages.dispatchEvent({
          projectId: project.id,
          source: MessageSource.OPEN_API,
          event: opts.event,
          variables: opts.variables,
          title: opts.title,
          content: opts.content,
          html: opts.html,
          priority: opts.priority,
          dedupeKey: dedupeKey || undefined,
        });
      } else {
        result = await this.messages.sendPush({
          projectId: project.id,
          source: MessageSource.OPEN_API,
          title: opts.title,
          content: opts.content,
          html: opts.html,
          extra: opts.extra,
          pushTemplate: opts.pushTemplate,
          variables: opts.variables,
          projectDispatch: true,
          priority: opts.priority,
          dedupeKey: dedupeKey || undefined,
        });
      }

      if (!result.success && result.status !== 'PENDING' && result.status !== 'DELAYED') {
        if (dedupeKey) {
          await this.idempotency.release({ projectId: project.id, key: `push:${dedupeKey}`, owner });
        }
        throw new HttpException(
          {
            success: false,
            data: { messageId: result.messageId, status: result.status },
            error: {
              code: 'SEND_FAILED',
              message: result.errorMessage || '发送失败',
            },
          },
          502,
        );
      }

      const data = {
        messageId: result.messageId,
        status: result.status,
        queued: !!result.queued,
        dispatch: (result as any).dispatch,
        delayed: !!result.delayed,
        releaseAt: result.releaseAt,
      };
      if (dedupeKey) {
        await this.idempotency.commit({
          projectId: project.id,
          key: `push:${dedupeKey}`,
          messageId: result.messageId,
          response: data,
          ttlMin: ttl,
          owner,
        });
      }
      return ok(data);
    } catch (e: any) {
      if (dedupeKey && e instanceof BadRequestException) {
        // 成功 commit 后不应释放；仅异常/502 前已处理。HttpException 502 已 release。
        const status = e instanceof HttpException ? e.getStatus() : 0;
        if (status !== 502) {
          try {
            await this.idempotency.release({
              projectId: project.id,
              key: `push:${dedupeKey}`,
              owner,
            });
          } catch {
            /* ignore */
          }
        }
      }
      throw e;
    }
  }
}
