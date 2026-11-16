import { json, urlencoded, Request } from 'express';

/** Keep upload buffers small unless the exact backup route has a current admin session. */
export function configureBodyParsers(server: any, authenticate: (request: Request) => Promise<void>) {
  const small = json({ limit: '256kb' });
  const backup = json({ limit: '20mb' });
  const form = urlencoded({ extended: false, limit: '256kb' });
  server.use(async (req: Request, res: any, next: any) => {
    const largeRoute = req.method === 'POST' && /^\/api\/admin\/backup\/(import|preview|export)\/?$/.test(req.path);
    if (largeRoute) {
      try { await authenticate(req); }
      catch { res.status(401).json({ success: false, data: null, error: { code: 'UNAUTHORIZED', message: '会话无效' } }); return; }
      backup(req, res, next);
    } else small(req, res, next);
  });
  server.use(form);
  server.use((error: any, _req: Request, res: any, next: any) => {
    if (error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed') {
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({ success: false, data: null, error: { code: error.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', message: error.type === 'entity.too.large' ? '请求正文超过大小限制' : 'JSON 格式错误' } });
    } else next(error);
  });
}
