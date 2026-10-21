import '../src/environment';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

it('upgrades a populated V1 database without losing existing records or assignments', async () => {
  const originalUrl = process.env.DATABASE_URL!;
  if (!['localhost', '127.0.0.1'].includes(new URL(originalUrl).hostname)) throw new Error('Migration test requires local PostgreSQL');
  const schema = 'spm_upgrade_' + randomBytes(8).toString('hex');
  const pool = new Pool({ connectionString: originalUrl });
  const runtimeRoot = resolve('.runtime');
  mkdirSync(runtimeRoot, { recursive: true });
  const directory = mkdtempSync(join(runtimeRoot, 'upgrade-'));
  const url = new URL(originalUrl); url.searchParams.set('schema', schema);
  const targetUrl = url.toString();
  let fixture: Pool | undefined;
  const cli = resolve('node_modules/prisma/build/index.js');
  function deploy(config: string) {
    execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--config', config], { env: { ...process.env, DATABASE_URL: targetUrl }, stdio: 'pipe' });
  }
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const migrations = join(directory, 'migrations'); mkdirSync(migrations);
    for (const entry of ['202610130001_initial', '202610130002_business_constraints', 'migration_lock.toml']) cpSync(resolve('prisma/migrations', entry), join(migrations, entry), { recursive: true });
    const configFile = join(directory, 'prisma.config.ts');
    writeFileSync(configFile, `import { defineConfig } from 'prisma/config'; export default defineConfig(${JSON.stringify({ schema: resolve('prisma/schema.prisma'), migrations: { path: migrations }, datasource: { url: targetUrl } })});`);
    deploy(configFile);
    fixture = new Pool({ connectionString: targetUrl, options: `-c search_path=${schema}` });
    await fixture.query(`INSERT INTO "User" (username,"passwordHash",role) VALUES ('upgrade-manager','fixture-hash','MANAGER'),('upgrade-member','fixture-hash','MEMBER')`);
    await fixture.query(`INSERT INTO "Project" (name,description,"managerId") VALUES ('existing project','existing description',1)`);
    await fixture.query(`INSERT INTO "ProjectMember" ("projectId","userId") VALUES (1,1),(1,2)`);
    await fixture.query(`INSERT INTO "Task" ("projectId",title,description,"assigneeUserId") VALUES (1,'existing task','existing task description',2)`);
    const queries = [
      'SELECT * FROM "User" ORDER BY id',
      'SELECT * FROM "Project" ORDER BY id',
      'SELECT id,"projectId","userId" FROM "ProjectMember" ORDER BY id',
      'SELECT * FROM "Task" ORDER BY id',
    ];
    const before = await Promise.all(queries.map(sql => fixture!.query(sql).then(result => result.rows)));
    // Upgrade to the full committed Sprint 1 before testing the Sprint 2 increment.
    cpSync(resolve('prisma/migrations/202610130003_v2_project_roles_requirements'), join(migrations, '202610130003_v2_project_roles_requirements'), { recursive: true });
    deploy(configFile);
    await fixture.query(`INSERT INTO "Requirement" ("projectId",title,description,"updatedAt") VALUES (1,'existing requirement','preserve me',CURRENT_TIMESTAMP)`);
    await fixture.query(`INSERT INTO "Session" (id,"userId","expiresAt") VALUES ('existing-session',2,CURRENT_TIMESTAMP + INTERVAL '1 day')`);
    const sprint1Queries = [...queries, 'SELECT * FROM "ProjectMember" ORDER BY id', 'SELECT * FROM "Requirement" ORDER BY id', 'SELECT * FROM "Session" ORDER BY id'];
    const sprint1Before = await Promise.all(sprint1Queries.map(sql => fixture!.query(sql).then(result => result.rows)));
    deploy(resolve('prisma.config.ts'));
    deploy(resolve('prisma.config.ts')); // Repeated deployment must be a no-op.
    execFileSync(process.execPath, [cli, 'migrate', 'diff', '--config', resolve('prisma.config.ts'), '--from-config-datasource', '--to-schema', resolve('prisma/schema.prisma'), '--exit-code'], { env: { ...process.env, DATABASE_URL: targetUrl }, stdio: 'pipe' });
    expect(await Promise.all(sprint1Queries.map(sql => fixture!.query(sql).then(result => result.rows)))).toEqual(sprint1Before);
    const after = await Promise.all(queries.map(sql => fixture!.query(sql).then(result => result.rows)));
    expect(after).toEqual(before);
    expect((await fixture.query('SELECT "userId",role FROM "ProjectMember" ORDER BY id')).rows).toEqual([{ userId: 1, role: 'MANAGER' }, { userId: 2, role: 'DEVELOPER' }]);
    expect((await fixture.query('SELECT count(*)::int AS count FROM "Requirement"')).rows[0].count).toBe(1);
    for (const table of ['ProductGoal', 'Epic', 'UserStory', 'StoryRequirement', 'StoryTask']) expect((await fixture.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count).toBe(0);
  } finally {
    if (fixture) await fixture.end();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
    // Only remove this test's verified, workspace-owned temporary directory.
    if (directory.startsWith(runtimeRoot + sep)) rmSync(directory, { recursive: true, force: true });
  }
}, 60000);
