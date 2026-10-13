import '../environment';
import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';

@Injectable()
export class DbService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
  async atomic<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // Serializable authorization + mutation, retry only conflicting transactions.
    for (let attempt = 0; ; attempt++) {
      try { return await this.$transaction(action, { isolationLevel: 'Serializable' }); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2) throw error;
      }
    }
  }
}
@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
