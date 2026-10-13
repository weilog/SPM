import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { isDatabaseConflict } from '../db/errors';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500, code = 'INTERNAL_ERROR', message: string | string[] = '服务器内部错误';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      message = typeof body === 'string' ? body : (body as { message: string | string[] }).message;
      code = { 400: 'VALIDATION_ERROR', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' }[status] || 'HTTP_ERROR';
    } else if (isDatabaseConflict(error)) {
      status = 409; code = 'CONFLICT'; message = '操作与数据约束冲突，请刷新后重试';
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      status = 404; code = 'NOT_FOUND'; message = '记录不存在';
    }
    if (status === 500) console.error(error);
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code, message });
  }
}
