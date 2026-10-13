import '../src/environment';
import { DbService } from '../src/db/db.module';
import { hashPassword } from '../src/auth/password';
async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set a private SEED_PASSWORD of at least 12 characters');
  const db = new DbService();
  try {
    await db.$connect();
    const passwordHash = await hashPassword(password);
    await db.atomic(async tx => {
      for (const [username, role] of [['admin', 'ADMIN'], ['manager', 'MANAGER'], ['manager_b', 'MANAGER'], ['member', 'MEMBER'], ['tester', 'MEMBER']] as const) {
        await tx.user.upsert({ where: { username }, update: {}, create: { username, role, passwordHash } });
      }
    });
    console.log('Seed complete: admin, manager, manager_b, member, tester. Project roles are assigned per membership. Existing accounts unchanged. Password is the private SEED_PASSWORD.');
  } finally { await db.$disconnect(); }
}
void main();
