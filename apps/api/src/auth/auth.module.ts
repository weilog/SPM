import { Body, Controller, Get, Injectable, Module, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { User } from '@spm/shared';
import { DbService } from '../db/db.module';
import { Actor, Public, tokenHash, userSelect } from '../common/security';
import { hashPassword, verifyPassword } from './password';

class LoginDto {
  @IsString() @Length(1, 80) username!: string;
  @IsString() @Length(1, 128) password!: string;
}
@Injectable()
export class AuthService {
  private dummy = hashPassword(randomBytes(24).toString('hex'));
  constructor(private readonly db: DbService) {}
  async login(dto: LoginDto) {
    const user = await this.db.user.findUnique({ where: { username: dto.username } });
    const valid = await verifyPassword(dto.password, user?.passwordHash || await this.dummy);
    if (!user?.active || !valid) throw new UnauthorizedException('用户名或密码错误');
    const token = randomBytes(32).toString('hex');
    const hours = Number(process.env.SESSION_HOURS || 8);
    const expiresAt = new Date(Date.now() + hours * 3600000);
    const selected = await this.db.atomic(async tx => {
      const current = await tx.user.findUnique({ where: { id: user.id }, select: { ...userSelect, passwordHash: true } });
      if (!current?.active || current.passwordHash !== user.passwordHash) throw new UnauthorizedException('登录已失效，请重试');
      await tx.session.create({ data: { id: tokenHash(token), userId: user.id, expiresAt } });
      const { passwordHash: _hash, ...safe } = current;
      return safe;
    });
    return { token, expiresAt, user: selected };
  }
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: DbService) {}
  @Public() @Post('login')
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto);
    if (typeof request.cookies?.spm_session === 'string') await this.db.session.deleteMany({ where: { id: tokenHash(request.cookies.spm_session) } });
    response.cookie('spm_session', result.token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/api', expires: result.expiresAt });
    return result.user;
  }
  @Get('me') me(@Actor() user: User) { return user; }
  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.db.session.deleteMany({ where: { id: tokenHash(request.cookies.spm_session) } });
    response.clearCookie('spm_session', { path: '/api', httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true' });
    return { ok: true };
  }
}
@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
