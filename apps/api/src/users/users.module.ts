import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  IsBoolean,
  IsEmail,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from "class-validator";
import type { User } from "@spm/shared";
import { DbService } from "../db/db.module";
import { Actor, Roles, userSelect } from "../common/security";
import { hashPassword } from "../auth/password";
const accountSelect = { ...userSelect, displayName: true, email: true, createdAt: true } as const;

class CreateUserDto {
  @IsString() @Length(1, 80) @Matches(/^[a-zA-Z0-9_.-]+$/) username!: string;
  @IsString() @Length(12, 128) password!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Length(1, 30) @Matches(/\S/) displayName?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail() @Length(3, 254) email?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean() active?: boolean;
}
class UpdateUserDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 80)
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  username?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(12, 128)
  password?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Length(1, 30) @Matches(/\S/) displayName?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail() @Length(3, 254) email?: string;
}
@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}
  async update(id: number, dto: UpdateUserDto, actor: User) {
    if (id === actor.id && dto.active === false)
      throw new BadRequestException("不能禁用当前登录的管理员账号");
    const passwordHash = dto.password
      ? await hashPassword(dto.password)
      : undefined;
    return this.db.atomic(async (tx) => {
      const existing = await tx.user.findUniqueOrThrow({ where: { id } });
      if (
        existing.active &&
        existing.role === "ADMIN" &&
        dto.active === false
      ) {
        if (
          (await tx.user.count({ where: { active: true, role: "ADMIN" } })) <= 1
        )
          throw new BadRequestException("必须保留一个有效系统管理员");
      }
      const { password: _password, ...data } = dto;
      const user = await tx.user.update({
        where: { id },
        data: { ...data, ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}), ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}), ...(passwordHash ? { passwordHash } : {}) },
        select: accountSelect,
      });
      if (passwordHash || dto.active === false)
        await tx.session.deleteMany({ where: { userId: id } });
      return user;
    });
  }
  async remove(id: number, actor: User) {
    if (id === actor.id) throw new BadRequestException("不能删除当前管理员");
    return this.db.atomic(async (tx) => {
      const existing = await tx.user.findUniqueOrThrow({ where: { id } });
      if (await tx.project.count({ where: { managerId: id } }))
        throw new BadRequestException("该用户负责项目，请停用账户");
      if (
        existing.active &&
        existing.role === "ADMIN" &&
        (await tx.user.count({ where: { active: true, role: "ADMIN" } })) <= 1
      )
        throw new BadRequestException("必须保留有效管理员");
      await tx.task.updateMany({
        where: { assigneeUserId: id },
        data: { assigneeUserId: null },
      });
      await tx.planStage.updateMany({
        where: { ownerUserId: id },
        data: { ownerUserId: null, revision: { increment: 1 } },
      });
      await tx.planItem.updateMany({
        where: { ownerUserId: id },
        data: { ownerUserId: null, revision: { increment: 1 } },
      });
      await tx.user.delete({ where: { id } });
      return { ok: true };
    });
  }
}
@Roles("ADMIN")
@Controller("users")
export class UsersController {
  constructor(
    private readonly db: DbService,
    private readonly users: UsersService,
  ) {}
  @Get() list() {
    return this.db.user.findMany({
      select: accountSelect,
      orderBy: { id: "asc" },
    });
  }
  @Post() async create(@Body() dto: CreateUserDto) {
    // US02 maintains accounts only. Global-role assignment belongs to US16/Sprint 2.
    return this.db.user.create({
      data: {
        username: dto.username,
        passwordHash: await hashPassword(dto.password),
        displayName: dto.displayName?.trim(),
        email: dto.email?.trim().toLowerCase(),
        active: dto.active,
      },
      select: accountSelect,
    });
  }
  @Patch(":id") update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @Actor() actor: User,
  ) {
    return this.users.update(id, dto, actor);
  }
  @Delete(":id") remove(
    @Param("id", ParseIntPipe) id: number,
    @Actor() actor: User,
  ) {
    return this.users.remove(id, actor);
  }
}
@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
