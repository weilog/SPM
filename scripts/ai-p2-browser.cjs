const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { resolve } = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { randomBytes } = require("node:crypto"),
  { execFileSync } = require("node:child_process"),
  { createServer: gatewayServer } = require("node:http");
const { chromium } = require("playwright"),
  { Pool } = require("../apps/api/node_modules/pg");
require("../apps/api/node_modules/reflect-metadata");
require("../apps/api/node_modules/dotenv").config({
  path: resolve(".env"),
  quiet: true,
});
// All automatic browser calls are confined to local, explicitly labeled fixtures.
process.env.AI_EXTERNAL_ENABLED = "false";
const realFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(typeof url === "string" ? url : url.url || url.href).hostname,
    )
  )
    throw new Error("Automatic P2 tests forbid paid external requests");
  return realFetch(url, options);
};
const dir = ".runtime/ai-p2-browser";
fs.mkdirSync(dir, { recursive: true });
const schema = "spm_ai_browser_" + randomBytes(8).toString("hex"),
  original = process.env.DATABASE_URL,
  password = randomBytes(20).toString("hex");
const checks = [],
  errors = [];
let app,
  vite,
  browser,
  gateway,
  pool,
  db,
  mode = "normal",
  calls = 0;
const until = async (fn, label) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error("Timed out: " + label);
};
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
(async () => {
  assert(["localhost", "127.0.0.1"].includes(new URL(original).hostname));
  pool = new Pool({ connectionString: original });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(original);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  Object.assign(process.env, {
    WEB_ORIGIN: "http://127.0.0.1:5178",
    AI_ENABLED: "true",
    AI_EXTERNAL_ENABLED: "false",
    AI_WORKER_POLL_MS: "25",
    AI_MAX_RUNS_PER_MINUTE: "1000",
    AI_MAX_RUNS_PER_PROJECT_24H: "10000",
  });
  execFileSync(
    process.execPath,
    [
      resolve("apps/api/node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--config",
      resolve("apps/api/prisma.config.ts"),
    ],
    { env: process.env, stdio: "pipe" },
  );
  const { NestFactory } = require("../apps/api/node_modules/@nestjs/core"),
    { AppModule } = require("../apps/api/dist/app.module"),
    { configure } = require("../apps/api/dist/bootstrap"),
    { DbService } = require("../apps/api/dist/db/db.module"),
    { AiConfig } = require("../apps/api/dist/ai/ai.config"),
    { hashPassword } = require("../apps/api/dist/auth/password");
  app = configure(await NestFactory.create(AppModule, { logger: false }));
  await app.listen(3005, "127.0.0.1");
  db = app.get(DbService);
  const hash = await hashPassword(password),
    users = {};
  for (const [name, role] of [
    ["manager", "MANAGER"],
    ["dev", "MEMBER"],
    ["tester", "MEMBER"],
    ["outsider", "MEMBER"],
  ])
    users[name] = await db.user.create({
      data: { username: name, passwordHash: hash, role },
    });
  const p = await db.project.create({
    data: {
      name: "爱管理 AI 七页验收项目",
      description: "真实 PostgreSQL 隔离测试；外部模型替换为本机协议夹具。",
      managerId: users.manager.id,
      members: {
        create: [
          { userId: users.manager.id, role: "MANAGER" },
          { userId: users.dev.id, role: "DEVELOPER" },
          { userId: users.tester.id, role: "TESTER" },
        ],
      },
    },
  });
  const goal = await db.productGoal.create({
      data: { projectId: p.id, title: "统一项目协作" },
    }),
    epic = await db.epic.create({
      data: { projectId: p.id, goalId: goal.id, title: "团队协作" },
    });
  const req = await db.requirement.create({
      data: {
        projectId: p.id,
        title: "安全管理项目成员",
        description: "邀请成员、调整角色、禁止越权。",
        acceptanceCriteria: "非经理不能调整角色。",
      },
    }),
    leaf = await db.requirement.create({
      data: { projectId: p.id, parentId: req.id, title: "验证成员调整权限" },
    });
  const story = await db.userStory.create({
    data: {
      projectId: p.id,
      epicId: epic.id,
      title: "项目经理邀请团队成员",
      description: "作为项目经理，希望邀请成员并分配角色。",
    },
  });
  await db.storyRequirement.create({
    data: { projectId: p.id, storyId: story.id, requirementId: req.id },
  });
  const stage = await db.planStage.create({
    data: {
      projectId: p.id,
      title: "功能开发与集成",
      start: "2020-01-01",
      end: "2020-01-31",
      ownerUserId: users.manager.id,
    },
  });
  const plan = await db.planItem.create({
    data: {
      projectId: p.id,
      stageId: stage.id,
      title: "成员授权接口联调",
      start: "2020-01-02",
      end: "2020-01-10",
      ownerUserId: users.dev.id,
    },
  });
  await db.planItem.create({
    data: {
      projectId: p.id,
      stageId: stage.id,
      title: "成员界面联调",
      start: "2020-01-05",
      end: "2020-01-15",
      ownerUserId: users.dev.id,
    },
  });
  await db.planItem.create({
    data: {
      projectId: p.id,
      stageId: stage.id,
      title: "阶段验收",
      kind: "milestone",
      start: "2020-01-31",
      end: "2020-01-31",
      ownerUserId: users.manager.id,
    },
  });
  const tasks = [];
  for (let i = 0; i < 4; i++) {
    const t = await db.task.create({
      data: {
        projectId: p.id,
        title: i === 3 ? "仅测试员可见的私有任务" : "成员接口实现 " + i,
        description: "实现权限校验、输入验证与可回归测试。",
        priority: "HIGH",
        assigneeUserId: i === 3 ? users.tester.id : users.dev.id,
      },
    });
    tasks.push(t);
    await db.taskPlanReference.create({
      data: { projectId: p.id, taskId: t.id, planId: plan.id },
    });
    await db.storyTask.create({
      data: { projectId: p.id, taskId: t.id, storyId: story.id },
    });
  }
  const fixture = (key, kind, extra = {}) => ({
    key,
    kind,
    title: "候选-" + key,
    description: "经人工核查的实施内容",
    acceptanceCriteria: "可复现地验证业务结果",
    ...extra,
  });
  gateway = gatewayServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls++;
    res.setHeader("Content-Type", "application/json");
    if (mode === "malformed") {
      res.end("{bad");
      return;
    }
    if (body.input.context) {
      const split = body.instructions.includes(
        "independent implementation TASK",
      );
      res.end(
        JSON.stringify({
          items: split
            ? [
                fixture("独立任务A", "TASK", {
                  storyKeys: [`story:${story.id}`],
                }),
              ]
            : [
                fixture("根需求", "REQUIREMENT"),
                fixture("子需求", "REQUIREMENT", { parentKey: "根需求" }),
                fixture("叶需求", "REQUIREMENT", { parentKey: "子需求" }),
                fixture("复用Epic", "EPIC", {
                  title: "团队协作",
                  goalKey: `goal:${goal.id}`,
                }),
                fixture("关联故事", "STORY", {
                  epicKey: "复用Epic",
                  requirementKeys: ["叶需求"],
                }),
                fixture("实施任务", "TASK", { storyKeys: ["关联故事"] }),
              ],
        })
          .replace(/"key":"根需求"/g, '"key":"root"')
          .replace(/"key":"子需求"/g, '"key":"child"')
          .replace(/"key":"叶需求"/g, '"key":"leaf"')
          .replace(/"key":"复用Epic"/g, '"key":"reuse_epic"')
          .replace(/"key":"关联故事"/g, '"key":"new_story"')
          .replace(/"key":"实施任务"/g, '"key":"new_task"')
          .replace(/"key":"独立任务A"/g, '"key":"split_a"')
          .replace(/"parentKey":"根需求"/g, '"parentKey":"root"')
          .replace(/"parentKey":"子需求"/g, '"parentKey":"child"')
          .replace(/"epicKey":"复用Epic"/g, '"epicKey":"reuse_epic"')
          .replace(/\["叶需求"\]/g, '["leaf"]')
          .replace(/\["关联故事"\]/g, '["new_story"]'),
      );
    } else
      res.end(
        JSON.stringify({
          explanations: body.input.findings.map((f) => ({
            eventKey: f.eventKey,
            explanation:
              "测试专用模型推断：需要核查真实证据，不代表因果或工时超负荷。",
            recommendation: "在原业务编辑器核查后人工处理。",
            evidenceKeys: f.evidence.map((e) => e.key),
          })),
        }),
      );
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  Object.assign(app.get(AiConfig), {
    externalEnabled: true,
    provider: "json-http",
    supplier: "LOCAL_TEST_FIXTURE",
    model: "NOT_REAL_AI",
    apiKey: "fixture-only",
    endpoint: `http://127.0.0.1:${gateway.address().port}`,
    approvedScope: "project-planning-v2",
    timeoutMs: 3000,
    maxOutputTokens: 3000,
    maxInputBytes: 120000,
    maxCalls24h: 1000,
  });
  const { createServer } = await import(
    pathToFileURL(require.resolve("vite", { paths: [resolve("apps/web")] }))
      .href
  );
  vite = await createServer({
    configFile: false,
    root: resolve("apps/web"),
    server: {
      host: "127.0.0.1",
      port: 5178,
      strictPort: true,
      proxy: {
        "/api": { target: "http://127.0.0.1:3005", changeOrigin: true },
      },
    },
  });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.SPM_CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const signIn = async (c, name) => {
    const r = await c.request.post("http://127.0.0.1:5178/api/auth/login", {
      headers: { "X-SPM-Request": "1" },
      data: { username: name, password },
    });
    assert.equal(r.status(), 201);
  };
  await signIn(context, "manager");
  await page.goto("http://127.0.0.1:5178/");
  await page.getByRole("button", { name: p.name, exact: true }).click();
  await page.locator(".ai-health-summary").waitFor();
  const nav = async (name) => {
    await page
      .locator(".sidebar")
      .getByRole("button", { name, exact: true })
      .click();
  };
  const shot = async (name) => {
    await page.screenshot({
      path: `${dir}/after-${name}.png`,
      animations: "disabled",
    });
  };
  const drawer = () => page.locator(".ai-drawer");
  const closeDrawer = async () => {
    await drawer().locator(".ant-drawer-close").click();
    await drawer().waitFor({ state: "hidden" });
  };
  async function scan(entry) {
    await page.getByRole("button", { name: entry, exact: true }).click();
    await drawer()
      .getByRole("button", { name: "开始分析", exact: true })
      .click();
    await until(
      async () => (await drawer().locator(".ai-risk").count()) > 0,
      "AI rules rendered",
    );
    await until(
      async () =>
        (await drawer()
          .getByText(
            "测试专用模型推断：需要核查真实证据，不代表因果或工时超负荷。",
            { exact: true },
          )
          .count()) > 0,
      "validated inference rendered",
    );
  }
  await scan("✦ 查看诊断报告");
  await shot("01-health");
  for (const dimension of [
    "进度风险",
    "计划风险",
    "任务分配风险",
    "人员负载风险",
  ])
    await drawer()
      .getByRole("button", { name: dimension, exact: true })
      .click();
  await drawer().getByRole("button", { name: "历史报告", exact: true }).click();
  await drawer()
    .getByRole("button", { name: "查看报告", exact: true })
    .first()
    .click();
  await closeDrawer();
  assert.equal(await page.locator(".ai-health-metrics > div").count(), 5);
  pass(
    "Overview manual health scan, four risk dimensions, unique-event summary and persisted history",
  );
  await nav("需求管理");
  await page
    .getByRole("button", { name: "✦ AI 智能规划", exact: true })
    .click();
  await page
    .getByLabel("AI 规划输入")
    .fill(
      "规划成员权限与团队协作，复用已有Epic并创建三级需求、故事和独立实施任务。",
    );
  await page.getByRole("button", { name: "开始 AI 分析", exact: true }).click();
  await page.locator(".ai-review-tree button").last().waitFor();
  assert.equal(await page.locator(".ai-review-tree button").count(), 6);
  await page.getByLabel("候选标题").fill("人工修改后的根需求");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await until(
    async () =>
      await page
        .getByRole("button", { name: "保存草稿", exact: true })
        .isDisabled(),
    "draft saved",
  );
  mode = "malformed";
  await page.getByText("规划输入与重新生成", { exact: true }).click();
  await page.getByRole("button", { name: "开始 AI 分析", exact: true }).click();
  await page.getByText(/生成未完成：FORMAT_ERROR/).waitFor();
  assert.equal(
    await page.getByLabel("候选标题").inputValue(),
    "人工修改后的根需求",
  );
  mode = "normal";
  await page.getByLabel("候选标题").fill("未保存的人工修改");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "返回业务页面", exact: true }).click();
  assert.equal(await page.locator(".ai-planner").count(), 1);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await until(
    async () =>
      await page
        .getByRole("button", { name: "保存草稿", exact: true })
        .isDisabled(),
    "second save",
  );
  await page.getByRole("button", { name: "返回业务页面", exact: true }).click();
  await page
    .getByRole("button", { name: "✦ AI 智能规划", exact: true })
    .click();
  await page.getByRole("button", { name: "我的草稿", exact: true }).click();
  await page
    .getByRole("button", { name: "恢复草稿", exact: true })
    .first()
    .click();
  assert.equal(
    await page.getByLabel("候选标题").inputValue(),
    "未保存的人工修改",
  );
  await shot("02-planning");
  const rows = page.locator(".ai-review-tree button");
  for (let i = 0; i < (await rows.count()); i++) {
    await rows.nth(i).click();
    if (i === 3) {
      await page.getByLabel("候选处理方式").click();
      await page.getByText("复用已有对象", { exact: true }).click();
      await page.getByLabel("复用对象").click();
      await page
        .locator(".ant-select-item-option-content")
        .filter({ hasText: `#${epic.id} · 团队协作` })
        .click();
    }
  }
  for (let i = 0; i < (await rows.count()); i++) {
    await rows.nth(i).click();
    await page.getByLabel("此候选已人工审核").check();
  }
  const countBefore = await db.requirement.count({
    where: { projectId: p.id },
  });
  await page
    .getByRole("button", { name: "确认提交审核结果", exact: true })
    .click();
  await page.getByRole("button", { name: "确认事务提交", exact: true }).click();
  await page.getByText(/事务提交成功/).waitFor();
  assert.equal(
    await db.requirement.count({ where: { projectId: p.id } }),
    countBefore + 3,
  );
  assert.equal(await db.epic.count({ where: { projectId: p.id } }), 1);
  await page.getByRole("button", { name: "返回业务页面", exact: true }).click();
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  await page
    .getByRole("button", { name: "未保存的人工修改", exact: true })
    .waitFor();
  pass(
    "Requirement AI input, persistent draft restore, failure preserves human edits, unsaved-leave guard, individual review/reuse and atomic three-level commit",
  );
  await page.getByRole("tab", { name: /故事地图/ }).click();
  await scan("✦ AI 覆盖检查");
  await shot("03-coverage");
  await drawer()
    .getByRole("button", { name: "生成完善候选", exact: true })
    .click();
  await page.locator(".ai-planner").waitFor();
  await page.getByRole("button", { name: "返回业务页面", exact: true }).click();
  pass(
    "Story map direct leaf coverage denominator, semantic inference and shared candidate-review entry retain original map",
  );
  await nav("任务管理");
  await scan("✦ AI 任务建议");
  await shot("04-task");
  await drawer()
    .getByRole("button", { name: "✦ 生成独立候选任务", exact: true })
    .click();
  await page.getByRole("button", { name: "开始 AI 分析", exact: true }).click();
  await page.locator(".ai-review-tree button").waitFor();
  await page.getByLabel("此候选已人工审核").check();
  await page
    .getByRole("button", { name: "确认提交审核结果", exact: true })
    .click();
  await page.getByRole("button", { name: "确认事务提交", exact: true }).click();
  await page.getByText(/事务提交成功/).waitFor();
  await page.getByRole("button", { name: "返回业务页面", exact: true }).click();
  await page
    .getByRole("button", { name: "候选-独立任务A", exact: true })
    .waitFor();
  assert.equal(
    (
      await db.task.findFirstOrThrow({
        where: { projectId: p.id, title: "候选-独立任务A" },
      })
    ).status,
    "TODO",
  );
  pass(
    "Task execution advice and independently reviewed TODO split candidates persist through real task/history APIs",
  );
  await nav("项目计划");
  await page.getByRole("button", { name: "甘特图", exact: true }).click();
  await scan("✦ AI 风险与推演");
  await drawer().getByRole("button", { name: "方案推演", exact: true }).click();
  const plansBefore = await db.planItem.findMany({
    where: { projectId: p.id },
  });
  await drawer()
    .getByRole("button", { name: "生成候选方案对比", exact: true })
    .click();
  await drawer().locator(".ai-scenario-change").first().waitFor();
  assert.deepEqual(
    await db.planItem.findMany({ where: { projectId: p.id } }),
    plansBefore,
  );
  await shot("05-scenarios");
  await drawer()
    .getByRole("button", { name: "打开原编辑器", exact: true })
    .first()
    .click();
  await page.locator(".a-plan-view .modal").waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).last().click();
  assert.deepEqual(
    await db.planItem.findMany({ where: { projectId: p.id } }),
    plansBefore,
  );
  pass(
    "Gantt baseline/candidate comparison is read-only and opens the original centered editor; cancel leaves all dates unchanged",
  );
  await page.getByRole("button", { name: "成员任务跟踪", exact: true }).click();
  await scan("✦ AI 负载与瓶颈");
  await shot("06-member");
  await closeDrawer();
  pass(
    "A member tracking retains its original grouping/filter table and reports actual Task-ID concentration without utilization claims",
  );
  await nav("多视图工作台");
  await scan("✦ AI 跨视图分析");
  await drawer().getByRole("button", { name: "关联证据", exact: true }).click();
  await shot("07-cross-view");
  await drawer()
    .getByRole("button", { name: `定位 task:${tasks[0].id}`, exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "成员任务图", exact: true }).waitFor();
  await until(
    async () => (await page.locator(".panes.dual").count()) === 1,
    "cross-view dual focus",
  );
  await until(
    async () => (await page.locator(".svg-node.selected").count()) > 0,
    "task evidence highlight",
  );
  pass(
    "Cross-view evidence uses real object IDs, activates correct dual views and focuses actual related nodes",
  );
  const dev = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await signIn(dev, "dev");
  const dp = await dev.newPage();
  dp.on("pageerror", (e) => errors.push(e.message));
  await dp.goto("http://127.0.0.1:5178/");
  await dp.getByRole("button", { name: p.name, exact: true }).click();
  await dp.getByRole("button", { name: "✦ 查看诊断报告", exact: true }).click();
  await dp.locator(".ai-risk").first().waitFor();
  assert.equal(
    await dp.getByRole("button", { name: "开始分析", exact: true }).count(),
    0,
  );
  assert.equal(
    await dp.getByRole("button", { name: "重新分析", exact: true }).count(),
    0,
  );
  assert(
    !(await dp
      .locator(".ai-drawer")
      .innerText()
      .then((t) => t.includes("仅测试员可见的私有任务"))),
  );
  assert.equal(
    (
      await dev.request.post(
        `http://127.0.0.1:5178/api/projects/${p.id}/ai/analyses`,
        { headers: { "X-SPM-Request": "1" }, data: { kind: "HEALTH" } },
      )
    ).status(),
    403,
  );
  await dev.close();
  const out = await browser.newContext();
  await signIn(out, "outsider");
  assert.equal(
    (
      await out.request.get(
        `http://127.0.0.1:5178/api/projects/${p.id}/ai/analyses`,
      )
    ).status(),
    404,
  );
  await out.close();
  pass(
    "Ordinary members get filtered facts and no analyze controls; backend rejects member writes and outsider reads",
  );
  assert.equal(errors.length, 0);
  fs.writeFileSync(
    `${dir}/result.json`,
    JSON.stringify(
      {
        result: "PASS",
        viewport: { width: 1440, height: 900 },
        provider: "EXPLICIT_LOCAL_TEST_FIXTURE_NOT_REAL_AI",
        paidModelCalls: 0,
        localFixtureCalls: calls,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  // Reference-only screenshots: the supplied static prototype is never an app page.
  const reference = await context.newPage();
  reference.on("dialog", (d) => d.accept());
  const referenceUrl = pathToFileURL(
    resolve("docs/ai-design/爱管理_AI化七页面_统一交互原型_V2.0.html"),
  ).href;
  for (const [name, pageName, sub] of [
    ["01-health", "overview", ""],
    ["02-planning", "requirements", "list"],
    ["03-coverage", "requirements", "map"],
    ["04-task", "tasks", ""],
    ["05-scenarios", "plan", "gantt"],
    ["06-member", "plan", "members"],
    ["07-cross-view", "workbench", ""],
  ]) {
    await reference.goto(referenceUrl);
    await reference.locator(".demo-toggle").click();
    await reference
      .locator(
        `[data-do="demo-go"][data-page="${pageName}"][data-sub="${sub}"]`,
      )
      .click();
    await reference.locator(".demo-toggle").click();
    if (name === "02-planning") {
      await reference.locator('[data-do="planner-start"]').first().click();
      await reference
        .locator("textarea")
        .first()
        .fill("规划成员权限与团队协作");
      await reference.locator('[data-do="planner-generate"]').click();
      await reference.getByText("AI 规划结果", { exact: true }).waitFor();
    }
    await reference.screenshot({
      path: `${dir}/prototype-${name}.png`,
      animations: "disabled",
    });
  }
  console.log(
    "Browser checks:",
    checks.length,
    "zero paid requests; zero runtime errors",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (vite) await vite.close();
    if (app) await app.close();
    if (gateway) {
      gateway.closeAllConnections();
      await new Promise((r) => gateway.close(r));
    }
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
