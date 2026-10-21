// Real React + NestJS + PostgreSQL smoke test, isolated in a disposable local schema.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { Pool } = require('../apps/api/node_modules/pg');
require('../apps/api/node_modules/reflect-metadata');
require('../apps/api/node_modules/dotenv').config({ path: resolve('.env'), quiet: true });

(async () => {
  const originalUrl = process.env.DATABASE_URL;
  assert(originalUrl && ['localhost', '127.0.0.1'].includes(new URL(originalUrl).hostname), 'Requires local PostgreSQL');
  const schema = 'spm_browser_' + randomBytes(8).toString('hex');
  const pool = new Pool({ connectionString: originalUrl });
  const url = new URL(originalUrl); url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.toString(); process.env.WEB_ORIGIN = 'http://127.0.0.1:5173';
  let app, vite, browser;
  const checks = [];
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    execFileSync(process.execPath, [resolve('apps/api/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma.config.ts'], { cwd: resolve('apps/api'), env: process.env, stdio: 'pipe' });
    const { NestFactory } = require('../apps/api/node_modules/@nestjs/core');
    const { AppModule } = require('../apps/api/dist/app.module');
    const { configure } = require('../apps/api/dist/bootstrap');
    const { DbService } = require('../apps/api/dist/db/db.module');
    const { hashPassword } = require('../apps/api/dist/auth/password');
    app = configure(await NestFactory.create(AppModule, { logger: false }));
    await app.listen(3000, '127.0.0.1');
    const db = app.get(DbService);
    const password = randomBytes(24).toString('hex');
    const passwordHash = await hashPassword(password);
    const manager = await db.user.create({ data: { username: 'browser_manager', role: 'MANAGER', passwordHash } });
    const developer = await db.user.create({ data: { username: 'browser_developer', passwordHash } });
    const project = await db.project.create({ data: { name: 'Sprint 2 第一阶段验收', description: '真实 API 和数据库验收工作区', managerId: manager.id, members: { create: [{ userId: manager.id, role: 'MANAGER' }, { userId: developer.id, role: 'DEVELOPER' }] } } });
    const task = await db.task.create({ data: { projectId: project.id, title: 'Sprint 1 回归任务', assigneeUserId: developer.id } });
    const { createServer } = await import(pathToFileURL(require.resolve('../apps/web/node_modules/vite')).href);
    vite = await createServer({ root: resolve('apps/web'), configFile: resolve('apps/web/vite.config.ts'), server: { host: '127.0.0.1', port: 5173, strictPort: true } });
    await vite.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.SPM_CHROME_PATH ? { executablePath: process.env.SPM_CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    async function login(who) {
      await page.goto('http://127.0.0.1:5173');
      await page.getByLabel('用户名', { exact: true }).fill(who);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: /登\s*录/ }).click();
      await page.getByRole('button', { name: '进入项目' }).click();
      await page.getByRole('tab', { name: '需求列表', exact: true }).waitFor();
    }
    async function saveModal() {
      const dialog = page.locator('.ant-modal[role="dialog"]');
      await dialog.getByRole('button', { name: /确\s*定|OK/ }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
    async function choose(label, option) {
      await page.locator('.ant-modal[role="dialog"]').getByLabel(label, { exact: true }).click();
      await page.locator('.ant-select-item-option-content').filter({ hasText: option }).click();
    }
    await login('browser_manager');
    await page.getByRole('button', { name: '创建正式需求' }).click();
    await page.getByLabel('需求标题', { exact: true }).fill('审批过程可追踪');
    await page.getByLabel('需求说明', { exact: true }).fill('保留正式需求与故事独立关系');
    await saveModal();
    await page.getByRole('tab', { name: '故事地图', exact: true }).click();
    await page.getByRole('button', { name: '新建产品目标' }).click();
    await page.getByLabel('产品目标标题', { exact: true }).fill('提升项目协作效率');
    await saveModal();
    for (const title of ['审批流程', '交付归档']) {
      await page.getByRole('button', { name: '新建 Epic', exact: true }).click();
      await page.getByLabel('Epic标题', { exact: true }).fill(title);
      await saveModal();
    }
    for (const title of ['提交项目审批', '查看审批结果']) {
      await page.getByRole('region', { name: 'Epic：审批流程' }).getByRole('button', { name: '新建用户故事' }).click();
      await page.getByLabel('用户故事标题', { exact: true }).fill(title);
      await page.getByLabel('故事描述', { exact: true }).fill('作为项目成员，我希望跟进审批过程');
      await page.getByLabel('验收标准', { exact: true }).fill('刷新后仍可查看审批状态');
      await choose('关联正式需求', '审批过程可追踪');
      await page.getByLabel('用户故事标题', { exact: true }).click();
      await saveModal();
    }
    let stories = await db.userStory.findMany({ where: { projectId: project.id }, orderBy: { id: 'asc' } });
    assert.equal(stories.length, 2);
    assert.equal(await db.storyRequirement.count({ where: { projectId: project.id } }), 2);
    checks.push('UI creates requirement, goal, two epics and two linked stories');
    await page.locator('.story-map[aria-busy="false"]').waitFor();
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith(`/stories/${stories[1].id}/move`) && r.status() === 200),
      page.getByRole('article', { name: `US-${String(stories[1].id).padStart(3, '0')}` }).dragTo(page.getByRole('article', { name: `US-${String(stories[0].id).padStart(3, '0')}` })),
    ]);
    // Poll persisted state to avoid relying on animation timing.
    async function eventually(fn) { for (let n = 0; n < 100; n++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timed out waiting for persisted state'); }
    await eventually(async () => (await db.userStory.findUniqueOrThrow({ where: { id: stories[1].id } })).sortOrder === 0);
    const storyCard = () => page.getByRole('article', { name: `US-${String(stories[0].id).padStart(3, '0')}` });
    await page.locator('.story-map[aria-busy="false"]').waitFor();
    await storyCard().dragTo(page.getByRole('region', { name: 'Epic：交付归档' }));
    const archiveEpic = await db.epic.findFirstOrThrow({ where: { projectId: project.id, title: '交付归档' } });
    await eventually(async () => (await db.userStory.findUniqueOrThrow({ where: { id: stories[0].id } })).epicId === archiveEpic.id);
    await page.reload(); await page.getByRole('button', { name: '进入项目' }).click(); await page.getByRole('tab', { name: '故事地图', exact: true }).click();
    await page.getByRole('region', { name: 'Epic：交付归档' }).getByRole('button', { name: '提交项目审批' }).waitFor();
    await page.locator('.requirements-workspace .ant-spin-blur').waitFor({ state: 'hidden' });
    mkdirSync('.runtime/s2-browser', { recursive: true });
    await page.screenshot({ path: '.runtime/s2-browser/story-map.png', fullPage: true, animations: 'disabled' });
    checks.push('Real drag reorder and cross-epic move survive browser reload');
    await page.getByRole('tab', { name: '故事看板', exact: true }).click();
    await page.locator('.story-board[aria-busy="false"]').waitFor();
    await storyCard().dragTo(page.getByRole('region', { name: '进行中', exact: true }));
    await eventually(async () => (await db.userStory.findUniqueOrThrow({ where: { id: stories[0].id } })).status === 'IN_PROGRESS');
    await page.getByRole('region', { name: '进行中', exact: true }).getByRole('button', { name: '提交项目审批' }).waitFor();
    await page.screenshot({ path: '.runtime/s2-browser/story-board.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '提交项目审批', exact: true }).click();
    await page.getByRole('combobox', { name: '故事状态' }).click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: '已完成' }).click();
    await eventually(async () => (await db.userStory.findUniqueOrThrow({ where: { id: stories[0].id } })).status === 'DONE');
    await page.getByRole('button', { name: '编辑用户故事' }).click();
    await page.getByLabel('用户故事标题', { exact: true }).fill('提交项目审批（已验证）');
    await saveModal();
    await page.locator('.ant-drawer-close').click();
    await page.getByRole('combobox', { name: '筛选 Epic' }).click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: '交付归档' }).click();
    await page.getByLabel('搜索故事').fill(`US-${String(stories[0].id).padStart(3, '0')}`);
    assert.equal(await page.getByRole('article').count(), 1);
    checks.push('Board drag, drawer status/edit, Epic filter and number search persist through real API');
    await page.route('**/api/projects/*/stories/*/status', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '验收模拟保存失败' }) }));
    await storyCard().dragTo(page.getByRole('region', { name: '待处理', exact: true }));
    await page.getByText('验收模拟保存失败', { exact: true }).first().waitFor();
    await page.getByRole('region', { name: '已完成', exact: true }).getByRole('button', { name: '提交项目审批（已验证）', exact: true }).waitFor();
    assert.equal((await db.userStory.findUniqueOrThrow({ where: { id: stories[0].id } })).status, 'DONE');
    await page.unroute('**/api/projects/*/stories/*/status');
    checks.push('Failed status write rolls back the card and shows an error');
    const headerHeight = await page.locator('.header').evaluate(e => e.getBoundingClientRect().height);
    assert.equal(headerHeight, 56);
    assert.equal(await page.locator('.workspace-sidebar').evaluate(e => e.getBoundingClientRect().width), 224);
    await page.getByRole('button', { name: '折叠导航' }).click();
    await eventually(async () => (await page.locator('.workspace-sidebar').evaluate(e => e.getBoundingClientRect().width)) === 64);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.runtime/s2-browser/mobile-board.png', fullPage: true, animations: 'disabled' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    checks.push('56px header, 224/64px navigation and mobile viewport checked');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: /退\s*出/ }).click();
    await login('browser_developer');
    assert.equal(await page.getByRole('button', { name: '创建正式需求' }).count(), 0);
    await page.getByRole('tab', { name: '故事地图', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '新建产品目标' }).count(), 0);
    assert.equal(await storyCard().getAttribute('draggable'), 'false');
    await page.getByRole('tab', { name: '我的任务', exact: true }).click();
    await page.getByText('Sprint 1 回归任务', { exact: true }).waitFor();
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'TODO');
    checks.push('Developer read-only views and Sprint 1 personal tasks retained');
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks, pageErrors }, null, 2));
  } catch (error) {
    if (browser) {
      mkdirSync('.runtime/s2-browser', { recursive: true });
      const page = browser.contexts()[0]?.pages()[0];
      if (page) await page.screenshot({ path: '.runtime/s2-browser/failure.png', fullPage: true });
    }
    console.error('Completed checks:', checks);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (vite) await vite.close();
    if (app) await app.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
