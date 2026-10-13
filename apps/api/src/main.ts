import 'reflect-metadata';
import './environment';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configure } from './bootstrap';
async function main() {
  const app = configure(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT || 3000), '127.0.0.1');
}
void main();
