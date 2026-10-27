import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { IsEmail, IsString, Length } from "class-validator";
import { Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@spm/shared";
import { DbService } from "../db/db.module";
import { Actor, Public, tokenHash, userSelect } from "../common/security";
import { hashPassword, verifyPassword } from "./password";

class LoginDto {
  @IsString() @Length(1, 80) username!: string;
  @IsString() @Length(1, 128) password!: string;
}
class RegisterDto {
  @IsString() @Length(3, 40) username!: string;
  @IsEmail() @Length(3, 254) email!: string;
  @IsString() @Length(12, 128) password!: string;
  @IsString() @Length(1, 256) inviteCode!: string;
}
class ForgotDto {
  @IsString() @Length(1, 80) username!: string;
  @IsEmail() @Length(3, 254) email!: string;
}
class ResetDto {
  @IsString() @Length(64, 64) token!: string;
  @IsString() @Length(12, 128) password!: string;
}
@Injectable()
export class AuthService {
  private dummy = hashPassword(randomBytes(24).toString("hex"));
  constructor(private readonly db: DbService) {}
  async register(dto: RegisterDto) {
    const invitation = process.env.REGISTRATION_INVITE_CODE;
    if (!invitation)
      throw new ServiceUnavailableException(
        "注册邀请尚未启用，请联系系统管理员",
      );
    if (
      !timingSafeEqual(
        Buffer.from(tokenHash(dto.inviteCode)),
        Buffer.from(tokenHash(invitation)),
      )
    )
      throw new ForbiddenException("管理员邀请码无效");
    const username = dto.username.trim(),
      email = dto.email.trim().toLowerCase();
    if (username.length < 3) throw new BadRequestException("用户名至少3位");
    return this.db.user.create({
      data: {
        username,
        email,
        passwordHash: await hashPassword(dto.password),
        role: "MEMBER",
      },
      select: userSelect,
    });
  }
  async forgot(dto: ForgotDto) {
    if (process.env.AUTH_MAIL_MODE !== 'simulation' || process.env.NODE_ENV === 'production')
      throw new ServiceUnavailableException('模拟密码找回尚未启用');
    const result = {
      message: "模拟邮件：如果用户名与绑定邮箱匹配，将生成重置链接；不会发送真实邮件。",
    };
    const user = await this.db.user.findUnique({
      where: { username: dto.username.trim() },
    });
    if (!user?.active || user.email !== dto.email.trim().toLowerCase())
      return result;
    const token = randomBytes(32).toString("hex");
    const inserted = await this.db.atomic(async (tx) => {
      // Keep simulation requests bounded while preserving real, single-use reset tokens.
      const recent = await tx.passwordReset.findFirst({
        where: {
          userId: user.id,
          createdAt: { gt: new Date(Date.now() - 60000) },
        },
      });
      if (recent) return false;
      await tx.passwordReset.deleteMany({ where: { userId: user.id } });
      await tx.passwordReset.create({
        data: {
          id: tokenHash(token),
          userId: user.id,
          passwordHash: user.passwordHash,
          expiresAt: new Date(Date.now() + 30 * 60000),
        },
      });
      return true;
    });
    if (!inserted) return { message: '模拟邮件：请等待60秒后重新申请，或使用刚才生成的重置链接。' };
    return {
      message: '模拟邮件已生成，未发送真实邮件。链接30分钟内有效，仅可使用一次。',
      simulatedResetUrl: `#reset?token=${encodeURIComponent(token)}`,
    };
  }
  async reset(dto: ResetDto) {
    const passwordHash = await hashPassword(dto.password);
    return this.db.atomic(async (tx) => {
      const reset = await tx.passwordReset.findUnique({
        where: { id: tokenHash(dto.token) },
        include: { user: true },
      });
      if (
        !reset ||
        reset.expiresAt <= new Date() ||
        !reset.user.active ||
        reset.user.passwordHash !== reset.passwordHash
      )
        throw new BadRequestException("重置链接无效或已过期，请重新申请");
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      });
      await tx.session.deleteMany({ where: { userId: reset.userId } });
      await tx.passwordReset.deleteMany({ where: { userId: reset.userId } });
      return { message: "密码已重置，请使用新密码登录。" };
    });
  }
  async login(dto: LoginDto) {
    const user = await this.db.user.findUnique({
      where: { username: dto.username },
    });
    const valid = await verifyPassword(
      dto.password,
      user?.passwordHash || (await this.dummy),
    );
    if (!user?.active || !valid)
      throw new UnauthorizedException("用户名或密码错误");
    const token = randomBytes(32).toString("hex");
    const hours = Number(process.env.SESSION_HOURS || 8);
    const expiresAt = new Date(Date.now() + hours * 3600000);
    const selected = await this.db.atomic(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: { ...userSelect, passwordHash: true },
      });
      if (!current?.active || current.passwordHash !== user.passwordHash)
        throw new UnauthorizedException("登录已失效，请重试");
      await tx.session.create({
        data: { id: tokenHash(token), userId: user.id, expiresAt },
      });
      const { passwordHash: _hash, ...safe } = current;
      return safe;
    });
    return { token, expiresAt, user: selected };
  }
}
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DbService,
  ) {}
  @Public() @Post("register") register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }
  @Public() @Post("forgot-password") forgot(@Body() dto: ForgotDto) {
    return this.auth.forgot(dto);
  }
  @Public() @Post("reset-password") reset(@Body() dto: ResetDto) {
    return this.auth.reset(dto);
  }
  @Public()
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto);
    if (typeof request.cookies?.spm_session === "string")
      await this.db.session.deleteMany({
        where: { id: tokenHash(request.cookies.spm_session) },
      });
    response.cookie("spm_session", result.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/api",
      expires: result.expiresAt,
    });
    return result.user;
  }
  @Get("me") me(@Actor() user: User) {
    return user;
  }
  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.db.session.deleteMany({
      where: { id: tokenHash(request.cookies.spm_session) },
    });
    response.clearCookie("spm_session", {
      path: "/api",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
    });
    return { ok: true };
  }
}
@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
