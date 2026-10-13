import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import type { Role, User } from '@spm/shared';
import { createHash } from 'node:crypto';
import { DbService } from '../db/db.module';

declare global { namespace Express { interface Request { actor?: User } } }
export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): User => context.switchToHttp().getRequest<Request>().actor!);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const userSelect = { id: true, username: true, role: true, active: true } as const;

@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(private readonly db: DbService, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.get('X-SPM-Request') !== '1' || (request.get('Origin') && request.get('Origin') !== process.env.WEB_ORIGIN)) {
        throw new ForbiddenException('请求来源验证失败');
      }
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const token: unknown = request.cookies?.spm_session;
    if (typeof token !== 'string' || token.length > 128) throw new UnauthorizedException('请先登录');
    const session = await this.db.session.findUnique({ where: { id: tokenHash(token) }, include: { user: { select: userSelect } } });
    if (!session || session.expiresAt <= new Date() || !session.user.active) throw new UnauthorizedException('登录已失效');
    request.actor = session.user;
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(session.user.role)) throw new ForbiddenException('无权执行此操作');
    return true;
  }
}
