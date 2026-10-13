import './environment';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { Public, SecurityGuard } from './common/security';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
@Controller('health')
class HealthController { @Public() @Get() health() { return { ok: true }; } }
@Module({ imports: [DbModule, AuthModule, UsersModule], controllers: [HealthController], providers: [{ provide: APP_GUARD, useClass: SecurityGuard }] })
export class AppModule {}
