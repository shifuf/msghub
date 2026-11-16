import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = '服务器内部错误';
    let data: unknown = null;
    let structured = false;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as any;
        structured = !!(b.error && typeof b.error === 'object' && typeof b.error.code === 'string');
        const candidate = structured ? b.error.message : b.message;
        message = Array.isArray(candidate) ? candidate.join('; ') : typeof candidate === 'string' ? candidate : message;
        code = structured ? b.error.code : typeof b.code === 'string' ? b.code : typeof b.error === 'string' ? b.error : HttpStatus[status] || code;
        if (structured && b.data !== undefined) data = b.data;
      }
    }

    if (status >= 500 && !structured) {
      code = 'INTERNAL_ERROR';
      message = '服务器内部错误';
      data = null;
    }

    res.status(status).json({
      success: false,
      data,
      error: { code, message },
    });
  }
}
