import 'reflect-metadata';
import '../src/environment';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configure } from '../src/bootstrap';
import { DbService } from '../src/db/db.module';
import { hashPassword } from '../src/auth/password';
import type { Role } from '@spm/shared';

describe('Sprint 1 PostgreSQL REST integration', () => {
  let app: INestApplication, db: DbService, pool: Pool;
  let admin: number, manager: number, managerB: number, member: number, outsider: number;
  let project: number, otherProject: number;
  const password = randomBytes(24).toString('hex');
  const schema = 'spm_test_' + randomBytes(8).toString('hex');
  const cookies: Record<string, string> = {};
  const originalUrl = process.env.DATABASE_URL!;
  function call(method: 'get' | 'post' | 'patch' | 'delete', path: string, who?: string, data?: object) {
    let test = request(app.getHttpServer())[method]('/api' + path).set('X-SPM-Request', '1').set('Origin', 'http://127.0.0.1:5173');
    if (who) test = test.set('Cookie', cookies[who]);
    if (data !== undefined) test = test.send(data);
    return test;
  }
  async function login(name: string) {
    const result = await call('post', '/auth/login', undefined, { username: name, password }).expect(201);
    const cookie = result.headers['set-cookie'][0] as string;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    cookies[name] = cookie.split(';')[0];
    return result;
  }
  beforeAll(async () => {
    if (!originalUrl || !['localhost', '127.0.0.1'].includes(new URL(originalUrl).hostname)) throw new Error('Tests require local PostgreSQL');
    pool = new Pool({ connectionString: originalUrl });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(originalUrl); url.searchParams.set('schema', schema);
    process.env.DATABASE_URL = url.toString(); process.env.WEB_ORIGIN = 'http://127.0.0.1:5173';
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma.config.ts'], { cwd: resolve('.'), env: process.env, stdio: 'pipe' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configure(module.createNestApplication()); await app.init(); db = app.get(DbService);
    const hash = await hashPassword(password);
    for (const [name, role] of [['admin', 'ADMIN'], ['manager', 'MANAGER'], ['manager_b', 'MANAGER'], ['member', 'MEMBER'], ['outsider', 'MEMBER']] as [string, Role][]) {
      await db.user.create({ data: { username: name, role, passwordHash: hash } });
      await login(name);
    }
    const users = await db.user.findMany();
    admin = users.find(user => user.username === 'admin')!.id;
    manager = users.find(user => user.username === 'manager')!.id;
    managerB = users.find(user => user.username === 'manager_b')!.id;
    member = users.find(user => user.username === 'member')!.id;
    outsider = users.find(user => user.username === 'outsider')!.id;
    project = (await call('post', '/projects', 'manager', { name: 'Alpha', description: 'Alpha-only-data' }).expect(201)).body.id;
    otherProject = (await call('post', '/projects', 'manager_b', { name: 'Beta' }).expect(201)).body.id;
    await call('post', `/projects/${project}/members`, 'manager', { userId: member }).expect(201);
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
    process.env.DATABASE_URL = originalUrl;
  });

  it('US01 rejects wrong password and unknown/inactive users', async () => {
    for (const username of ['admin', 'missing']) await call('post', '/auth/login', undefined, { username, password: 'wrong' }).expect(401);
    const user = await db.user.create({ data: { username: 'inactive', passwordHash: await hashPassword(password), active: false } });
    await call('post', '/auth/login', undefined, { username: user.username, password }).expect(401);
  });
  it('US01 rejects unauthenticated requests with a consistent error', async () => {
    for (const path of ['/auth/me', '/users', '/projects', `/projects/${project}/tasks`]) {
      const result = await call('get', path).expect(401);
      expect(result.body).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
    }
  });
  it('US01 returns current user without password or session secrets', async () => {
    const result = await call('get', '/auth/me', 'member').expect(200);
    expect(result.body).toEqual({ id: member, username: 'member', role: 'MEMBER', active: true });
  });
  it('US01 logout revokes a copied token on the server', async () => {
    await login('outsider');
    const oldCookie = cookies.outsider;
    await call('post', '/auth/logout', 'outsider', {}).expect(201);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
    await login('outsider');
  });
  it('rejects cross-origin writes and missing custom headers', async () => {
    await request(app.getHttpServer()).post('/api/projects').set('Cookie', cookies.manager).send({ name: 'CSRF' }).expect(403);
    await request(app.getHttpServer()).post('/api/projects').set('Cookie', cookies.manager).set('X-SPM-Request', '1').set('Origin', 'https://attacker.example').send({ name: 'CSRF' }).expect(403);
  });
  it('US02 permits admin CRUD/global grants and denies every other role', async () => {
    const created = (await call('post', '/users', 'admin', { username: 'created', password, role: 'MEMBER' }).expect(201)).body;
    expect(created).not.toHaveProperty('passwordHash');
    await call('patch', `/users/${created.id}`, 'admin', { role: 'MANAGER', username: 'renamed' }).expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: created.id } })).role).toBe('MANAGER');
    await call('patch', `/users/${created.id}`, 'admin', { role: 'MEMBER' }).expect(200);
    for (const who of ['member', 'manager', 'manager_b']) {
      await call('get', '/users', who).expect(403);
      await call('patch', `/users/${created.id}`, who, { role: 'ADMIN' }).expect(403);
      await call('delete', `/users/${created.id}`, who).expect(403);
      await call('post', '/users', who, { username: 'forged', password, role: 'ADMIN' }).expect(403);
    }
    await call('delete', `/users/${created.id}`, 'admin').expect(200);
    expect(await db.user.findUnique({ where: { id: created.id } })).toBeNull();
  });
  it('US02 validates passwords/usernames/roles and duplicate usernames', async () => {
    for (const data of [{ username: 'weak', password: '123', role: 'MEMBER' }, { username: 'invalid space', password, role: 'MEMBER' }, { username: 'role', password, role: 'OWNER' }]) await call('post', '/users', 'admin', data).expect(400);
    await call('post', '/users', 'admin', { username: 'member', password, role: 'MEMBER' }).expect(409);
  });
  it('US02 preserves the last administrator and protects assigned managers from deletion', async () => {
    await call('patch', `/users/${admin}`, 'admin', { active: false }).expect(400);
    await call('patch', `/users/${admin}`, 'admin', { role: 'MEMBER' }).expect(400);
    await call('delete', `/users/${admin}`, 'admin').expect(400);
    await call('delete', `/users/${manager}`, 'admin').expect(400);
  });
  it('US03 binds managers automatically and rejects forged manager identities', async () => {
    const created = (await call('post', '/projects', 'manager', { name: '  Trimmed  ' }).expect(201)).body;
    expect(created.managerId).toBe(manager); expect(created.name).toBe('Trimmed');
    expect(await db.projectMember.count({ where: { projectId: created.id, userId: manager } })).toBe(1);
    await call('post', '/projects', 'manager', { name: 'Forged', managerId: managerB }).expect(400);
    await call('post', '/projects', 'member', { name: 'Denied' }).expect(403);
  });
  it('US03 requires admins to select an active manager and validates required name', async () => {
    await call('post', '/projects', 'admin', { name: 'Admin project', managerId: managerB }).expect(201);
    for (const managerId of [undefined, member]) await call('post', '/projects', 'admin', { name: 'Rejected', managerId }).expect(400);
    for (const name of ['', ' ', 'x'.repeat(201)]) await call('post', '/projects', 'manager', { name }).expect(400);
    await call('post', '/projects', 'manager', { name: 'Extra', projectId: otherProject }).expect(400);
  });
  it('US04 adds/removes members, rejects duplicates and protects the manager', async () => {
    await call('post', `/projects/${project}/members`, 'manager', { userId: outsider }).expect(201);
    await call('post', `/projects/${project}/members`, 'manager', { userId: outsider }).expect(409);
    await call('delete', `/projects/${project}/members/${manager}`, 'manager').expect(400);
    await call('delete', `/projects/${project}/members/${outsider}`, 'manager').expect(200);
    await call('post', `/projects/${project}/members`, 'manager', { userId: -1 }).expect(400);
  });
  it('US04 does not grant management to a member with global manager identity', async () => {
    await call('post', `/projects/${project}/members`, 'manager', { userId: managerB }).expect(201);
    await call('get', `/projects/${project}`, 'manager_b').expect(200);
    await call('post', `/projects/${project}/members`, 'manager_b', { userId: outsider }).expect(403);
    await call('delete', `/projects/${project}/members/${member}`, 'manager_b').expect(403);
    await call('delete', `/projects/${otherProject}/members/${member}`, 'manager').expect(404);
    await call('delete', `/projects/${project}/members/${managerB}`, 'manager').expect(200);
  });
  it('US06 scopes the list and direct project lookups', async () => {
    const list = (await call('get', '/projects', 'member').expect(200)).body;
    expect(list.map((item: { id: number }) => item.id)).toEqual([project]);
    await call('get', `/projects/${otherProject}`, 'member').expect(404);
    await call('get', `/projects/${project}`, 'outsider').expect(404);
    expect((await call('get', '/projects', 'admin').expect(200)).body.length).toBeGreaterThan(1);
  });
  it('US06 supports membership in multiple projects and revokes access on removal', async () => {
    await call('post', `/projects/${otherProject}/members`, 'manager_b', { userId: member }).expect(201);
    for (const id of [project, otherProject]) expect((await call('get', `/projects/${id}`, 'member').expect(200)).body.id).toBe(id);
    await call('delete', `/projects/${otherProject}/members/${member}`, 'manager_b').expect(200);
    await call('get', `/projects/${otherProject}`, 'member').expect(404);
  });
  it('US07 creates persistent TODO tasks but rejects blank title or forged status/project', async () => {
    const task = (await call('post', `/projects/${project}/tasks`, 'manager', { title: '  Work  ', description: 'Detail' }).expect(201)).body;
    expect(task).toMatchObject({ projectId: project, title: 'Work', status: 'TODO', assigneeUserId: null });
    for (const data of [{ title: '' }, { title: ' ' }, { title: 'x'.repeat(201) }, { title: 'status', status: 'DONE' }, { title: 'project', projectId: otherProject }]) await call('post', `/projects/${project}/tasks`, 'manager', data).expect(400);
    await call('post', `/projects/${project}/tasks`, 'member', { title: 'Denied' }).expect(403);
    await call('post', `/projects/${otherProject}/tasks`, 'manager', { title: 'Denied' }).expect(404);
  });
  it('US09 assigns/reassigns/clears only effective members and hides cross-project tasks', async () => {
    const task = (await call('post', `/projects/${project}/tasks`, 'manager', { title: 'Assign', assigneeUserId: member }).expect(201)).body;
    const path = `/projects/${project}/tasks/${task.id}/assignee`;
    for (const assigneeUserId of [manager, member, null]) expect((await call('patch', path, 'manager', { assigneeUserId }).expect(200)).body.assigneeUserId).toBe(assigneeUserId);
    await call('patch', path, 'manager', { assigneeUserId: outsider }).expect(400);
    await call('patch', path, 'member', { assigneeUserId: member }).expect(403);
    await call('patch', `/projects/${otherProject}/tasks/${task.id}/assignee`, 'manager_b', { assigneeUserId: managerB }).expect(404);
    await call('patch', path, 'manager', {}).expect(400);
    await call('patch', path, 'manager', { assigneeUserId: member, title: 'Forged' }).expect(400);
  });
  it('US09 rejects inactive member assignments and database bypasses', async () => {
    const inactive = await db.user.findUniqueOrThrow({ where: { username: 'inactive' } });
    await call('post', `/projects/${project}/members`, 'manager', { userId: inactive.id }).expect(400);
    // Trusted fixture bypass to test the database active-user trigger itself.
    await db.projectMember.create({ data: { projectId: project, userId: inactive.id } });
    await call('post', `/projects/${project}/tasks`, 'manager', { title: 'Rejected', assigneeUserId: inactive.id }).expect(400);
    await expect(db.task.create({ data: { projectId: project, title: 'DB inactive', assigneeUserId: inactive.id } })).rejects.toThrow();
    await expect(db.task.create({ data: { projectId: project, title: 'DB other', assigneeUserId: managerB } })).rejects.toThrow();
    await expect(db.task.create({ data: { projectId: project, title: 'DB status', status: 'DONE' } })).rejects.toThrow();
  });
  it('US09 removes assignments only within the removed membership project', async () => {
    await call('post', `/projects/${otherProject}/members`, 'manager_b', { userId: member }).expect(201);
    const first = await db.task.create({ data: { projectId: project, title: 'First', assigneeUserId: member } });
    const second = await db.task.create({ data: { projectId: otherProject, title: 'Second', assigneeUserId: member } });
    await call('delete', `/projects/${otherProject}/members/${member}`, 'manager_b').expect(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: first.id } })).assigneeUserId).toBe(member);
    expect((await db.task.findUniqueOrThrow({ where: { id: second.id } })).assigneeUserId).toBeNull();
  });
  it('US02/09 deactivation revokes sessions and clears assignments atomically', async () => {
    await call('patch', `/users/${member}`, 'admin', { active: false }).expect(200);
    await call('get', '/auth/me', 'member').expect(401);
    expect(await db.task.count({ where: { assigneeUserId: member } })).toBe(0);
    await call('patch', `/users/${member}`, 'admin', { active: true }).expect(200);
    await login('member');
  });
  it('US02/03/04/07 global manager revocation takes effect on existing sessions', async () => {
    await call('patch', `/users/${manager}`, 'admin', { role: 'MEMBER' }).expect(200);
    await call('get', `/projects/${project}`, 'manager').expect(200);
    await call('post', '/projects', 'manager', { name: 'Revoked' }).expect(403);
    await call('post', `/projects/${project}/tasks`, 'manager', { title: 'Denied' }).expect(403);
    await call('post', `/projects/${project}/members`, 'manager', { userId: outsider }).expect(403);
    await call('patch', `/users/${manager}`, 'admin', { role: 'MANAGER' }).expect(200);
  });
  it('US02 password changes invalidate old sessions and passwords', async () => {
    await call('patch', `/users/${outsider}`, 'admin', { password: password + 'new' }).expect(200);
    await call('get', '/auth/me', 'outsider').expect(401);
    await call('post', '/auth/login', undefined, { username: 'outsider', password }).expect(401);
    await call('post', '/auth/login', undefined, { username: 'outsider', password: password + 'new' }).expect(201);
  });
  it('rejects explicit null for non-nullable optional DTO fields', async () => {
    for (const field of ['username', 'password', 'role', 'active']) await call('patch', `/users/${member}`, 'admin', { [field]: null }).expect(400);
    await call('post', '/projects', 'manager', { name: 'Null description', description: null }).expect(400);
    await call('post', `/projects/${project}/tasks`, 'manager', { title: 'Null description', description: null }).expect(400);
  });
  it('concurrent duplicate membership creation preserves uniqueness', async () => {
    const results = await Promise.all([
      call('post', `/projects/${project}/members`, 'manager', { userId: outsider }),
      call('post', `/projects/${project}/members`, 'manager', { userId: outsider }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await db.projectMember.count({ where: { projectId: project, userId: outsider } })).toBe(1);
    await call('delete', `/projects/${project}/members/${outsider}`, 'manager').expect(200);
  });
  it('assignment racing with deactivation never leaves an inactive assignee', async () => {
    const task = await db.task.create({ data: { projectId: project, title: 'Race' } });
    const results = await Promise.all([
      call('patch', `/projects/${project}/tasks/${task.id}/assignee`, 'manager', { assigneeUserId: member }),
      call('patch', `/users/${member}`, 'admin', { active: false }),
    ]);
    expect(results[1].status).toBe(200);
    expect([200, 400, 409]).toContain(results[0].status);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeUserId).toBeNull();
    await call('patch', `/users/${member}`, 'admin', { active: true }).expect(200);
  });
});
