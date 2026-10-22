const assert = require("node:assert/strict");
const fs = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { Pool } = require("../apps/api/node_modules/pg");
require("../apps/api/node_modules/reflect-metadata");
require("../apps/api/node_modules/dotenv").config({
  path: resolve(".env"),
  quiet: true,
});
const reference = require("./fixtures/v43-reference.json");
(async () => {
  const original = process.env.DATABASE_URL;
  assert(
    original && ["127.0.0.1", "localhost"].includes(new URL(original).hostname),
  );
  const schema = "spm_v43_browser_" + randomBytes(8).toString("hex");
  const pool = new Pool({ connectionString: original });
  const url = new URL(original);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  process.env.WEB_ORIGIN = "http://127.0.0.1:5174";
  let app, vite, browser;
  const checks = [],
    errors = [];
  const dir = ".runtime/v43-audit";
  fs.mkdirSync(dir, { recursive: true });
  const log = (s) => {
    checks.push(s);
    console.log("PASS", s);
  };
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    execFileSync(
      process.execPath,
      [
        resolve("apps/api/node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--config",
        "prisma.config.ts",
      ],
      { cwd: resolve("apps/api"), env: process.env, stdio: "pipe" },
    );
    const { NestFactory } = require("../apps/api/node_modules/@nestjs/core");
    const { AppModule } = require("../apps/api/dist/app.module");
    const { configure } = require("../apps/api/dist/bootstrap");
    const { DbService } = require("../apps/api/dist/db/db.module");
    const { hashPassword } = require("../apps/api/dist/auth/password");
    app = configure(await NestFactory.create(AppModule, { logger: false }));
    await app.listen(3001, "127.0.0.1");
    const db = app.get(DbService);
    const password = randomBytes(24).toString("hex"),
      passwordHash = await hashPassword(password);
    const manager = await db.user.create({
        data: { username: "项目经理", role: "MANAGER", passwordHash },
      }),
      users = {};
    for (const m of reference.members)
      users[m.id] = await db.user.create({
        data: { username: m.name, role: "MEMBER", passwordHash },
      });
    const project = await db.project.create({
      data: {
        name: "爱管理开发项目",
        description:
          "面向团队的项目管理与多视图协同平台，统一组织需求、计划与任务。",
        managerId: manager.id,
        members: {
          create: [
            { userId: manager.id, role: "MANAGER" },
            ...reference.members.map((m) => ({
              userId: users[m.id].id,
              role: m.role,
            })),
          ],
        },
      },
    });
    for (const [i, name] of [
      "课程资料管理系统",
      "校园活动管理平台",
      "研发协作工具",
      "实验交付管理",
      "知识共享计划",
    ].entries())
      await db.project.create({
        data: {
          name,
          description: [
            "课程资源维护、任务协调与文档管理工作空间。",
            "组织校园活动计划、人员分工与进度跟踪。",
            "项目协作流程规范及内部工具体系优化。",
            "用于实验过程记录、交付材料整理及项目协同。",
            "跨小组协作知识沉淀和计划执行。",
          ][i],
          managerId: manager.id,
          members: {
            create: {
              userId: manager.id,
              role: i < 2 || i === 4 ? "DEVELOPER" : "MANAGER",
            },
          },
        },
      });
    const reqs = {},
      goals = {},
      epics = {},
      stories = {},
      tasks = {};
    for (const r of reference.requirements)
      reqs[r.id] = await db.requirement.create({
        data: {
          projectId: project.id,
          title: r.title,
          description: r.description,
          updatedAt: new Date(r.updatedAt + "T00:00:00Z"),
        },
      });
    for (const r of reference.requirements)
      if (r.parentId)
        await db.requirement.update({
          where: { id: reqs[r.id].id },
          data: {
            parentId: reqs[r.parentId].id,
            updatedAt: new Date(r.updatedAt + "T00:00:00Z"),
          },
        });
    for (const [sortOrder, g] of reference.goals.entries())
      goals[g.id] = await db.productGoal.create({
        data: { projectId: project.id, title: g.name, sortOrder },
      });
    for (const [sortOrder, e] of reference.epics.entries())
      epics[e.id] = await db.epic.create({
        data: {
          projectId: project.id,
          goalId: goals[e.goalId].id,
          title: e.name,
          sortOrder,
        },
      });
    for (const s of reference.stories) {
      stories[s.id] = await db.userStory.create({
        data: {
          projectId: project.id,
          epicId: epics[s.epicId].id,
          title: s.title,
          description: s.description,
          acceptanceCriteria: s.acceptance,
          status: s.status,
          sortOrder: s.sort - 1,
        },
      });
      for (const r of s.reqIds)
        await db.storyRequirement.create({
          data: {
            projectId: project.id,
            storyId: stories[s.id].id,
            requirementId: reqs[r].id,
          },
        });
    }
    for (const t of reference.tasks) {
      tasks[t.id] = await db.task.create({
        data: {
          projectId: project.id,
          title: t.title,
          description: t.desc,
          assigneeUserId: users[t.member]?.id ?? null,
          status: t.status,
          priority: t.priority,
          progress: t.progress,
        },
      });
      for (const s of t.storyIds)
        await db.storyTask.create({
          data: {
            projectId: project.id,
            taskId: tasks[t.id].id,
            storyId: stories[s].id,
          },
        });
      await db.taskHistory.create({
        data: {
          taskId: tasks[t.id].id,
          actorUserId: manager.id,
          actorName: manager.username,
          action: "创建任务",
          before: {},
          after: { title: t.title, status: t.status, priority: t.priority },
        },
      });
    }
    const scene = reference.uml[0],
      diagram = await db.umlDiagram.create({
        data: {
          projectId: project.id,
          name: scene.name,
          boundary: {
            x: 260,
            y: 52,
            width: 477,
            height: 397,
            name: "爱管理项目管理系统",
          },
        },
      }),
      nodes = {};
    for (const n of [...scene.actors, ...scene.uses]) {
      nodes[n.id] = await db.umlNode.create({
        data: {
          projectId: project.id,
          diagramId: diagram.id,
          name: n.name,
          kind: scene.actors.includes(n) ? "ACTOR" : "USE_CASE",
          description: n.desc || "",
          x: n.x,
          y: n.y,
        },
      });
      for (const s of n.storyIds || [])
        await db.umlStory.create({
          data: {
            projectId: project.id,
            nodeId: nodes[n.id].id,
            storyId: stories[s].id,
          },
        });
    }
    for (const e of scene.edges)
      await db.umlEdge.create({
        data: {
          projectId: project.id,
          diagramId: diagram.id,
          fromId: nodes[e.from].id,
          toId: nodes[e.to].id,
          kind: e.kind,
        },
      });
    const { createServer } = await import(
      pathToFileURL(require.resolve("../apps/web/node_modules/vite")).href
    );
    vite = await createServer({
      root: resolve("apps/web"),
      configFile: resolve("apps/web/vite.config.ts"),
      server: {
        host: "127.0.0.1",
        port: 5174,
        strictPort: true,
        proxy: { "/api": "http://127.0.0.1:3001" },
      },
    });
    await vite.listen();
    browser = await chromium.launch({
      headless: true,
      ...(process.env.SPM_CHROME_PATH
        ? { executablePath: process.env.SPM_CHROME_PATH }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    async function login(p, name) {
      await p.goto("http://127.0.0.1:5174");
      await p.getByLabel("用户名", { exact: true }).fill(name);
      await p.getByLabel("密码", { exact: true }).fill(password);
      await p.getByRole("button", { name: /登\s*录/ }).click();
      await p.locator(".a-projects").waitFor();
    }
    async function enter(p) {
      await p
        .getByRole("button", { name: "爱管理开发项目", exact: true })
        .click();
      await p.locator(".a-overview").waitFor();
    }
    const nav = async (name, p = page) => {
      await p
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
    const eventually = async (fn, label) => {
      for (let i = 0; i < 100; i++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Persistence timeout: " + label);
    };
    async function save() {
      const modal = page.locator(".ant-modal[role=dialog]:visible");
      await modal.getByRole("button", { name: /保\s*存|确\s*定|OK/ }).click();
      await modal.waitFor({ state: "hidden" });
    }
    async function select(label, text, p = page) {
      await p
        .locator(".ant-modal[role=dialog]:visible")
        .getByLabel(label, { exact: true })
        .click();
      await p
        .locator(".ant-select-item-option-content")
        .filter({ hasText: text })
        .last()
        .click();
    }
    const request = async (method, path, data, p = page) => {
      const r = await p.request[method](
        "http://127.0.0.1:5174/api/projects/" + project.id + path,
        {
          headers: { "X-SPM-Request": "1", Origin: "http://127.0.0.1:5174" },
          ...(data !== undefined ? { data } : {}),
        },
      );
      assert(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`);
      return r.json();
    };
    await login(page, manager.username);
    await shot("projects");
    await page.getByLabel("搜索项目").fill("课程");
    assert.equal(await page.locator(".a-projects .cards .card").count(), 1);
    await page.getByLabel("搜索项目").fill("");
    await page.getByLabel("项目角色筛选").selectOption("MANAGER");
    assert.equal(await page.locator(".a-projects .cards .card").count(), 3);
    await page.getByLabel("项目角色筛选").selectOption("all");
    await page.getByRole("button", { name: "☷ 列表" }).click();
    assert.equal(await page.locator(".a-projects tbody tr").count(), 6);
    await shot("projects-list");
    await page.getByRole("button", { name: "▦ 卡片" }).click();
    await enter(page);
    await page.locator(".a-overview .workrow").first().waitFor();
    await shot("overview");
    log(
      "Authorized project search, role filters, statistics, card/list switch and enter",
    );
    await nav("需求管理");
    await page.locator("[data-req-row]").last().waitFor();
    await page.getByRole("button", { name: "全部展开" }).click();
    await shot("requirements");
    assert.equal(await page.locator("[data-req-row]").count(), 7);
    await page
      .getByRole("button", { name: "收起用户与权限管理的子需求" })
      .click();
    assert.equal(await page.locator("[data-req-row]").count(), 5);
    await page.getByLabel("搜索需求编号或标题").fill("用户");
    await page
      .getByRole("button", { name: "收起用户与权限管理的子需求" })
      .click();
    assert.equal(await page.locator("[data-req-row]").count(), 1);
    await page.getByRole("button", { name: "全部展开" }).click();
    assert((await page.locator("[data-req-row]").count()) > 1);
    await page.getByRole("button", { name: "全部收起" }).click();
    assert.equal(await page.locator("[data-req-row]").count(), 1);
    await page.getByRole("button", { name: "清除筛选" }).click();
    await page.getByRole("button", { name: "全部展开" }).click();
    const rootRow = page.locator(`[data-req-row="${reqs["REQ-001"].id}"]`);
    await rootRow.getByRole("button", { name: "子需求", exact: true }).click();
    await page
      .getByLabel("需求标题", { exact: true })
      .fill("浏览器新增二级需求");
    await save();
    let newChild = await db.requirement.findFirstOrThrow({
      where: { projectId: project.id, title: "浏览器新增二级需求" },
    });
    assert.equal(newChild.parentId, reqs["REQ-001"].id);
    await page.getByRole("button", { name: "全部展开" }).click();
    await page
      .locator(`[data-req-row="${newChild.id}"]`)
      .getByRole("button", { name: "子需求", exact: true })
      .click();
    await page
      .getByLabel("需求标题", { exact: true })
      .fill("浏览器新增三级需求");
    await save();
    const leaf = await db.requirement.findFirstOrThrow({
      where: { title: "浏览器新增三级需求" },
    });
    await page.getByRole("button", { name: "全部展开" }).click();
    assert.equal(
      await page
        .locator(`[data-req-row="${leaf.id}"]`)
        .getByRole("button", { name: "子需求", exact: true })
        .count(),
      0,
    );
    await page
      .locator(`[data-req-row="${leaf.id}"]`)
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await select("上级需求", "任务与协作管理");
    await page.getByRole("checkbox", { name: /US-003/ }).check();
    await save();
    assert.equal(
      await db.storyRequirement.count({ where: { requirementId: leaf.id } }),
      1,
    );
    assert.equal(
      (await db.requirement.findUniqueOrThrow({ where: { id: leaf.id } }))
        .parentId,
      reqs["REQ-002"].id,
    );
    await page
      .locator(`[data-req-row="${leaf.id}"]`)
      .getByRole("button", { name: "浏览器新增三级需求", exact: true })
      .click();
    await page.locator(".ant-drawer").waitFor();
    assert.equal(
      Math.round(
        await page
          .locator(".ant-drawer-content-wrapper")
          .evaluate((e) => e.getBoundingClientRect().width),
      ),
      640,
    );
    await shot("requirement-drawer");
    await page.locator(".ant-drawer-close:visible").click();
    log(
      "Three-level requirement create/reparent, search collapse/expand and 640px detail drawer",
    );
    await page.getByRole("tab", { name: /故事地图/ }).click();
    await page.locator(".story-card").first().waitFor();
    await shot("map");
    const card = (id) =>
      page.getByRole("article", { name: `US-${String(id).padStart(3, "0")}` });
    await page.locator(".story-map[aria-busy=false]").waitFor();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith(`/stories/${stories["US-002"].id}/move`) && r.ok(),
      ),
      card(stories["US-002"].id).dragTo(card(stories["US-001"].id)),
    ]);
    await page.locator(".story-map[aria-busy=false]").waitFor();
    assert.equal(
      (
        await db.userStory.findUniqueOrThrow({
          where: { id: stories["US-002"].id },
        })
      ).sortOrder,
      0,
    );
    await card(stories["US-001"].id).dragTo(
      page.getByRole("region", { name: "Epic：任务与协作" }),
    );
    await eventually(
      async () =>
        (
          await db.userStory.findUniqueOrThrow({
            where: { id: stories["US-001"].id },
          })
        ).epicId === epics["EP-002"].id,
      "cross epic",
    );
    await page.locator(".story-map[aria-busy=false]").waitFor();
    await page.getByRole("button", { name: "产品目标", exact: true }).click();
    await page.getByLabel("产品目标名称", { exact: true }).fill("交付验收目标");
    await save();
    await page
      .locator(".b-goal-card")
      .filter({ hasText: "交付验收目标" })
      .click();
    await page.getByRole("button", { name: "Epic", exact: true }).click();
    await page.getByLabel("Epic 名称", { exact: true }).fill("交付验收 Epic");
    await save();
    await page.getByRole("button", { name: "新建故事", exact: true }).click();
    await page
      .getByLabel("故事标题", { exact: true })
      .fill("浏览器创建并关联故事");
    await page
      .getByLabel("故事描述", { exact: true })
      .fill("通过真实表单创建故事");
    await page.getByLabel("验收标准", { exact: true }).fill("刷新后数据仍存在");
    await page.getByRole("checkbox", { name: /REQ-007/ }).check();
    await save();
    assert.equal(
      await db.userStory.count({
        where: { projectId: project.id, title: "浏览器创建并关联故事" },
      }),
      1,
    );
    await page.getByRole("tab", { name: /故事看板/ }).click();
    await shot("board");
    await card(stories["US-002"].id).dragTo(
      page.getByRole("region", { name: "进行中", exact: true }),
    );
    await eventually(
      async () =>
        (
          await db.userStory.findUniqueOrThrow({
            where: { id: stories["US-002"].id },
          })
        ).status === "IN_PROGRESS",
      "board status",
    );
    await page.locator(".story-board[aria-busy=false]").waitFor();
    await page
      .getByRole("button", { name: stories["US-002"].title, exact: true })
      .click();
    await page.getByRole("combobox", { name: "故事状态", exact: true }).click();
    await page
      .locator(".ant-select-item-option-content")
      .filter({ hasText: "已完成" })
      .click();
    await eventually(
      async () =>
        (
          await db.userStory.findUniqueOrThrow({
            where: { id: stories["US-002"].id },
          })
        ).status === "DONE",
      "drawer status",
    );
    await page.locator(".ant-drawer-close:visible").click();
    await page.getByLabel("搜索故事").fill("US-002");
    assert.equal(await page.getByRole("article").count(), 1);
    await page.getByRole("button", { name: "清空筛选" }).click();
    await page.route("**/api/projects/*/stories/*/status", (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "验收模拟保存失败" }),
      }),
    );
    await card(stories["US-002"].id).dragTo(
      page.getByRole("region", { name: "待处理", exact: true }),
    );
    await page.getByText("验收模拟保存失败", { exact: true }).first().waitFor();
    await page
      .getByRole("region", { name: "已完成", exact: true })
      .getByRole("article", { name: "US-002" })
      .waitFor();
    await page.unroute("**/api/projects/*/stories/*/status");
    await nav("任务管理");
    log(
      "Story same-epic reorder, cross-epic move, board/drawer status, search and failed-save rollback",
    );
    await page.locator("[data-task-row]").last().waitFor();
    await shot("tasks");
    const task2 = tasks["T-002"];
    const taskRow = (id) => page.locator(`[data-task-row="${id}"]`);
    await taskRow(task2.id)
      .getByRole("button", { name: "T-002更多操作" })
      .click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    const mb = await menu.boundingBox(),
      rb = await taskRow(task2.id).boundingBox();
    assert(
      mb.y < rb.y + rb.height + 20 && mb.y + mb.height > rb.y - 20,
      "Menu must anchor beside its task row",
    );
    await shot("task-menu");
    await menu
      .getByRole("menuitem", { name: "更新完成进度", exact: true })
      .click();
    const slider = page.getByRole("slider", { name: "完成百分比" });
    await slider.focus();
    await page.keyboard.press("Home");
    for (let i = 0; i < 70; i++) await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: /保存进度/ }).click();
    await eventually(
      async () =>
        (await db.task.findUniqueOrThrow({ where: { id: task2.id } }))
          .progress === 70,
      "inline progress",
    );
    await page.locator(".ant-drawer-close:visible").click();
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: task2.id } })).progress,
      70,
    );
    await taskRow(task2.id)
      .getByRole("button", { name: "T-002更多操作" })
      .click();
    await page
      .getByRole("menuitem", { name: "调整负责人", exact: true })
      .click();
    await select("新的主要负责人", "李四");
    await save();
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: task2.id } }))
        .assigneeUserId,
      users["U-002"].id,
    );
    await taskRow(task2.id)
      .getByRole("button", { name: "T-002更多操作" })
      .click();
    await page
      .getByRole("menuitem", { name: "管理故事 / 计划关联", exact: true })
      .click();
    await page
      .getByLabel("任务标题", { exact: true })
      .fill("实现任务分配接口（已验证）");
    await save();
    await taskRow(task2.id)
      .getByRole("button", { name: "T-002更多操作" })
      .click();
    await page
      .getByRole("menuitem", { name: "查看操作记录", exact: true })
      .click();
    await page.getByRole("heading", { name: "操作记录" }).waitFor();
    await shot("task-drawer");
    await page.locator(".ant-drawer-close:visible").click();
    const archiveTask = tasks["T-006"];
    await taskRow(archiveTask.id)
      .getByRole("button", { name: "T-006更多操作" })
      .click();
    await page.getByRole("menuitem", { name: "归档任务", exact: true }).click();
    await page
      .locator(".ant-modal-confirm")
      .getByRole("button", { name: /确\s*定|OK/ })
      .click();
    await eventually(
      async () =>
        !!(await db.task.findUniqueOrThrow({ where: { id: archiveTask.id } }))
          .archivedAt,
      "archive",
    );
    await page.getByRole("button", { name: "归档管理", exact: true }).click();
    await taskRow(archiveTask.id)
      .getByRole("button", { name: "恢复", exact: true })
      .click();
    await page
      .locator(".ant-modal-confirm")
      .getByRole("button", { name: /确\s*定|OK/ })
      .click();
    await eventually(
      async () =>
        !(await db.task.findUniqueOrThrow({ where: { id: archiveTask.id } }))
          .archivedAt,
      "restore",
    );
    await page
      .getByRole("button", { name: "返回任务列表", exact: true })
      .click();
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    await page
      .getByLabel("任务标题", { exact: true })
      .fill("浏览器创建完整任务");
    await page
      .getByLabel("任务描述", { exact: true })
      .fill("通过真实界面创建并关联故事");
    await select("负责人", "张三");
    await select("优先级", "高");
    await page.getByRole("checkbox", { name: /US-003/ }).check();
    await page.getByLabel("任务标题", { exact: true }).click();
    await save();
    const personalTask = await db.task.findFirstOrThrow({
      where: { title: "浏览器创建完整任务" },
    });
    assert.equal(personalTask.priority, "HIGH");
    assert.equal(
      await db.storyTask.count({ where: { taskId: personalTask.id } }),
      1,
    );
    log(
      "Row-anchored floating menu, progress, reassignment, edit, history, archive/restore and full task creation",
    );
    await page.getByRole("tab", { name: "成员任务图", exact: true }).click();
    await shot("members");
    const svg = page.getByRole("img", { name: "成员任务关系图" });
    const oldWidth = await page
      .locator(".graph-svg")
      .evaluate((e) => e.getBoundingClientRect().width);
    await page.getByRole("button", { name: "放大成员任务图" }).click();
    assert(
      (await page
        .locator(".graph-svg")
        .evaluate((e) => e.getBoundingClientRect().width)) > oldWidth,
    );
    await page.getByLabel("图成员筛选").selectOption(String(users["U-002"].id));
    assert.equal(
      await page
        .locator(".graph-svg g.svg-node")
        .filter({ hasText: "张三" })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page
      .locator(".graph-svg")
      .getByRole("button", { name: /T-002/ })
      .click();
    await page.locator(".ant-drawer-close:visible").click();
    assert((await page.locator(".graph-svg .selected").count()) > 0);
    log(
      "Actual member/task nodes and edges, zoom, filters, highlights and task detail",
    );
    await nav("多视图工作台");
    await page.getByRole("button", { name: "地图 + UML", exact: true }).click();
    await page
      .getByLabel("按故事快速定位")
      .selectOption(String(stories["US-003"].id));
    await eventually(
      async () =>
        (await page
          .locator('.viewpane[aria-label="右侧视图"] .uml-node.highlight')
          .count()) > 0,
      "story -> UML highlight",
    );
    await shot("workbench-dual");
    const useId = nodes["UC-002"].id;
    await page
      .locator(`.viewpane[aria-label="右侧视图"] [data-node-id="${useId}"]`)
      .click();
    await page.locator(".ant-drawer-close:visible").click();
    await eventually(
      async () =>
        (await page
          .locator('.viewpane[aria-label="左侧视图"] .story-card.highlight')
          .count()) > 0,
      "UML -> story highlight",
    );
    await page
      .getByRole("combobox", { name: "右侧视图", exact: true })
      .selectOption("members");
    await page
      .locator('.viewpane[aria-label="右侧视图"] .graph-svg')
      .getByRole("button", { name: /T-002/ })
      .click();
    await page.locator(".ant-drawer-close:visible").click();
    await page.getByRole("button", { name: "单视图", exact: true }).click();
    await page.getByRole("tab", { name: "UML 用例图", exact: true }).click();
    await shot("uml");
    const umlWidth = await page
      .locator(".uml-svg")
      .evaluate((e) => e.getBoundingClientRect().width);
    await page.getByRole("button", { name: "放大UML" }).click();
    assert(
      (await page
        .locator(".uml-svg")
        .evaluate((e) => e.getBoundingClientRect().width)) > umlWidth,
    );
    await page.getByRole("button", { name: "适应", exact: true }).click();
    await page
      .getByLabel("UML 故事定位")
      .selectOption(String(stories["US-003"].id));
    await page
      .getByRole("button", { name: "从故事创建用例草稿", exact: true })
      .click();
    await page.getByLabel("名称", { exact: true }).fill("验收用例");
    await save();
    const newUse = await db.umlNode.findFirstOrThrow({
      where: { diagramId: diagram.id, name: "验收用例" },
    });
    await page.getByLabel("UML 故事定位").selectOption("");
    const u = page.locator(`[data-node-id="${newUse.id}"]`);
    await u.scrollIntoViewIfNeeded();
    const ub = await u.boundingBox();
    await page.mouse.move(ub.x + ub.width / 2, ub.y + ub.height / 2);
    await page.mouse.down();
    await page.mouse.move(ub.x + ub.width / 2 + 35, ub.y + ub.height / 2 - 40, {
      steps: 8,
    });
    await page.mouse.up();
    await eventually(
      async () =>
        (await db.umlNode.findUniqueOrThrow({ where: { id: newUse.id } }))
          .revision > 0,
      "UML drag persistence",
    );
    await page.getByRole("button", { name: "连线", exact: true }).click();
    await page.getByLabel("UML 关系类型").selectOption("include");
    await u.click();
    await page.locator(`[data-node-id="${useId}"]`).click();
    await eventually(
      async () =>
        (await db.umlEdge.count({
          where: { fromId: newUse.id, toId: useId, kind: "include" },
        })) === 1,
      "include edge",
    );
    await page.getByRole("button", { name: "系统边界", exact: true }).click();
    await page.getByLabel("宽度", { exact: true }).fill("520");
    await save();
    assert.equal(
      (await db.umlDiagram.findUniqueOrThrow({ where: { id: diagram.id } }))
        .boundary.width,
      520,
    );
    await page.getByRole("button", { name: "新图", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("业务模块用例图");
    await save();
    assert.equal(
      await db.umlDiagram.count({ where: { projectId: project.id } }),
      2,
    );
    await page.getByLabel("UML 图选择").selectOption(String(diagram.id));
    log(
      "Five view navigation, two-way real relation focus, UML story drafts, drag persistence, include edge, editable boundary and multiple diagrams",
    );
    await page.getByRole("tab", { name: "甘特图", exact: true }).click();
    await page.getByLabel("甘特图时间尺度").selectOption("day");
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await shot("gantt-pending");
    await nav("项目计划");
    await shot("plan-pending");
    await nav("项目文档");
    await page
      .getByText("项目文档服务待对接负责人 A", { exact: true })
      .waitFor();
    await nav("成员与角色");
    await page.getByRole("heading", { name: "项目成员" }).waitFor();
    log(
      "A plan/Gantt complete timeline controls retained; missing plan/document APIs explicitly pending, no demo data",
    );
    const peerContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      }),
      peer = await peerContext.newPage();
    peer.setDefaultTimeout(12000);
    peer.on("pageerror", (e) => errors.push(e.message));
    await login(peer, manager.username);
    await enter(peer);
    await nav("需求管理", peer);
    await peer.getByRole("tab", { name: /故事看板/ }).click();
    await request("patch", `/stories/${stories["US-004"].id}/status`, {
      status: "IN_PROGRESS",
      revision: (
        await db.userStory.findUniqueOrThrow({
          where: { id: stories["US-004"].id },
        })
      ).revision,
    });
    await peer
      .getByRole("region", { name: "进行中", exact: true })
      .getByRole("article", { name: "US-004" })
      .waitFor();
    await peerContext.close();
    log(
      "Two authenticated browsers synchronize persisted state through authorized SSE",
    );
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await login(page, "张三");
    await enter(page);
    await nav("我的任务");
    await page.locator(`[data-task-row="${personalTask.id}"]`).waitFor();
    await shot("mytasks");
    assert.equal(
      await page.getByRole("button", { name: "新建任务", exact: true }).count(),
      0,
    );
    await taskRow(personalTask.id)
      .getByRole("button", { name: "开始", exact: true })
      .click();
    await taskRow(personalTask.id)
      .getByRole("button", {
        name: new RegExp("T-00" + personalTask.id + "更多操作"),
      })
      .click();
    await page
      .getByRole("menuitem", { name: "更新完成进度", exact: true })
      .click();
    const ownSlider = page.getByRole("slider", { name: "完成百分比" });
    await ownSlider.focus();
    await page.keyboard.press("Home");
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: /保存进度/ }).click();
    await eventually(
      async () =>
        (await db.task.findUniqueOrThrow({ where: { id: personalTask.id } }))
          .progress === 40,
      "owner inline progress",
    );
    await page.locator(".ant-drawer-close:visible").click();
    await taskRow(personalTask.id)
      .getByRole("button", { name: "完成", exact: true })
      .click();
    await eventually(
      async () =>
        (await db.task.findUniqueOrThrow({ where: { id: personalTask.id } }))
          .progress === 100,
      "owner completion",
    );
    await taskRow(personalTask.id)
      .getByRole("button", {
        name: new RegExp("T-00" + personalTask.id + "更多操作"),
      })
      .click();
    assert.equal(
      await page
        .getByRole("menuitem", { name: "重新打开", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("menuitem", { name: "调整负责人", exact: true })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
    await nav("需求管理");
    assert.equal(
      await page.getByRole("button", { name: "新建需求", exact: true }).count(),
      0,
    );
    await page.getByRole("tab", { name: /故事地图/ }).click();
    assert.equal(await page.locator(".story-card[draggable=true]").count(), 0);
    log(
      "Developer personal execution/percentage/DONE rules and read-only requirement/story permissions",
    );
    assert.equal(
      await page
        .locator(".topbar")
        .evaluate((e) => e.getBoundingClientRect().height),
      56,
    );
    assert.equal(
      await page
        .locator(".sidebar")
        .evaluate((e) => e.getBoundingClientRect().width),
      224,
    );
    await page.getByRole("button", { name: "折叠侧栏" }).click();
    await eventually(
      async () =>
        Math.round(
          await page
            .locator(".sidebar")
            .evaluate((e) => e.getBoundingClientRect().width),
        ) === 64,
      "collapsed navigation",
    );
    assert.deepEqual(errors, []);
    log("56/224/64px layout and zero browser runtime exceptions");
    const revokerContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      }),
      revoker = await revokerContext.newPage();
    await login(revoker, manager.username);
    await enter(revoker);
    await request(
      "delete",
      `/members/${users["U-001"].id}`,
      undefined,
      revoker,
    );
    await page.locator(".a-projects").waitFor();
    assert.equal(await page.locator(".requirements-workspace").count(), 0);
    assert.equal(
      (
        await page.request.get(
          `http://127.0.0.1:5174/api/projects/${project.id}/requirements`,
        )
      ).status(),
      404,
    );
    await revokerContext.close();
    log(
      "Revoking membership closes the live project and blocks subsequent reads",
    );
    const testerContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      }),
      tester = await testerContext.newPage();
    await login(tester, "王五");
    await enter(tester);
    await nav("需求管理", tester);
    assert.equal(
      await tester
        .getByRole("button", { name: "新建需求", exact: true })
        .count(),
      0,
    );
    await tester.getByRole("tab", { name: /故事地图/ }).click();
    assert.equal(
      await tester.locator(".story-card[draggable=true]").count(),
      0,
    );
    await tester.screenshot({
      path: `${dir}/after-tester-readonly.png`,
      animations: "disabled",
    });
    await testerContext.close();
    log("Tester receives the same read-only requirement/story controls");

    fs.writeFileSync(
      `${dir}/result.json`,
      JSON.stringify(
        {
          result: "PASS",
          viewport: { width: 1440, height: 900 },
          checks,
          pageErrors: errors,
          pending: [
            "A real plan API/plan links/date writes/end-to-end Gantt integration",
            "A document service",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          checks,
          pageErrors: errors,
          pending: ["A plan integration", "A document service"],
        },
        null,
        2,
      ),
    );
  } catch (e) {
    if (browser) {
      const p = browser.contexts()[0]?.pages()[0];
      if (p) await p.screenshot({ path: `${dir}/failure.png`, fullPage: true });
    }
    console.error("Completed", checks, "page errors", errors);
    throw e;
  } finally {
    if (browser) await browser.close();
    if (vite) await vite.close();
    if (app) await app.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
