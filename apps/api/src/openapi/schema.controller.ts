import { Controller, Get } from '@nestjs/common';

/** Public, credential-free schema for project integrations. */
@Controller('openapi')
export class OpenApiSchemaController {
  @Get('schema')
  schema() {
    const response = { description: '统一结果；成功为 {success:true,data}，失败为 {success:false,error:{code,message},data}' };
    const push = {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' }, content: { type: 'string' }, html: { type: 'string' },
        pushTemplate: { type: 'string' }, event: { type: 'string' },
        variables: { type: 'object', additionalProperties: true }, extra: { type: 'object', additionalProperties: true },
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] }, dedupeKey: { type: 'string' },
      },
    };
    const operation = (summary: string, schema: object, idempotent = true) => ({
      summary, security: [{ projectKey: [] }],
      parameters: idempotent ? [{ in: 'header', name: 'Idempotency-Key', schema: { type: 'string' }, description: '同一业务重试使用相同值；完成后同键返回缓存结果，处理中返回409。不同正文必须换新键。未完成占用不会因超时自动重发。' }] : [],
      requestBody: { required: true, content: { 'application/json': { schema } } },
      responses: { '200': response, '201': response, '400': response, '401': response, '409': response, '429': response, '502': response },
    });
    return {
      openapi: '3.0.3', info: { title: 'MsgHub 项目接入 API', version: '1.0.0', description: '请求正文上限256KB。配置、管理和浏览器设备协议参见对接开发文档。此规范覆盖项目推送和邮件入口。' },
      servers: [{ url: '/api' }],
      components: { securitySchemes: { projectKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
      paths: {
        '/webhook': { post: operation('发送通知', push) },
        '/webhook/dry-run': { post: operation('预览渲染、渠道和静默规则，不发送也不占用配额', push, false) },
        '/email': { post: operation('发送邮件', { type: 'object', additionalProperties: false, required: ['to'], properties: { to: { type: 'string' }, subject: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, html: { type: 'string' }, template: { type: 'string' }, variables: { type: 'object' }, dedupeKey: { type: 'string' }, priority: { type: 'string' }, event: { type: 'string' } } }) },
        '/templates': { get: { summary: '可用邮件模板', security: [{ projectKey: [] }], responses: { '200': response, '401': response } } },
      },
    };
  }
}
