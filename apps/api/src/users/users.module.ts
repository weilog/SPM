import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator';
import type { User, Role } from '@spm/shared';
import { DbService } from '../db/db.module';
import { Actor, Roles, userSelect } from '../common/security';
import { hashPassword } from '../auth/password';

class CreateUserDto {
  @IsString() @Length(1, 80) @Matches(/^[a-zA-Z0-9_.-]+$/) username!: string;
  @IsString() @Length(12, 128) password!: string;
  @IsIn(['ADMIN', 'MANAGER', 'MEMBER']) role!: Role;
}
class UpdateUserDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 80) @Matches(/^[a-zA-Z0-9_.-]+$/) username?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(12, 128) password?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['ADMIN', 'MANAGER', 'MEMBER']) role?: Role;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() active?: boolean;
}
@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}
  async update(id: number, dto: UpdateUserDto) {
    const passwordHash = dto.password ? await hashPassword(dto.password) : undefined;
    return this.db.atomic(async tx => {
      const existing = await tx.user.findUniqueOrThrow({ where: { id } });
      if (existing.active && existing.role === 'ADMIN' && (dto.active === false || (dto.role && dto.role !== 'ADMIN'))) {
        if (await tx.user.count({ where: { active: true, role: 'ADMIN' } }) <= 1) throw new BadRequestException('必须保留一个有效系统管理员');
      }
      const { password: _password, ...data } = dto;
      const user = await tx.user.update({ where: { id }, data: { ...data, ...(passwordHash ? { passwordHash } : {}) }, select: userSelect });
      if (passwordHash || dto.active === false) await tx.session.deleteMany({ where: { userId: id } });
      return user;
    });
  }
  async remove(id: number, actor: User) {
    if (id === actor.id) throw new BadRequestException('不能删除当前管理员');
    return this.db.atomic(async tx => {
      const existing = await tx.user.findUniqueOrThrow({ where: { id } });
      if (await tx.project.count({ where: { managerId: id } })) throw new BadRequestException('该用户负责项目，请停用账户');
      if (existing.active && existing.role === 'ADMIN' && await tx.user.count({ where: { active: true, role: 'ADMIN' } }) <= 1) throw new BadRequestException('必须保留有效管理员');
      await tx.task.updateMany({ where: { assigneeUserId: id }, data: { assigneeUserId: null } });
      await tx.user.delete({ where: { id } });
      return { ok: true };
    });
  }
}
@Roles('ADMIN') @Controller('users')
export class UsersController {
  constructor(private readonly db: DbService, private readonly users: UsersService) {}
  @Get() list() { return this.db.user.findMany({ select: userSelect, orderBy: { id: 'asc' } }); }
  @Post() async create(@Body() dto: CreateUserDto) {
    return this.db.user.create({ data: { username: dto.username, role: dto.role, passwordHash: await hashPassword(dto.password) }, select: userSelect });
  }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) { return this.users.update(id, dto); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number, @Actor() actor: User) { return this.users.remove(id, actor); }
}
@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
