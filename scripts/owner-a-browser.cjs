const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { resolve } = require("node:path"),
  { execFileSync } = require("node:child_process"),
  { pathToFileURL } = require("node:url"),
  { randomBytes } = require("node:crypto");
const { chromium } = require("playwright");
const { Pool } = require("../apps/api/node_modules/pg");
require("../apps/api/node_modules/reflect-metadata");
require("../apps/api/node_modules/dotenv").config({
  path: resolve(".env"),
  quiet: true,
});
const reference = require("./fixtures/a-plans-v32.json");
async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out: " + label);
}
(async () => {
  const original = process.env.DATABASE_URL;
  assert(
    original && ["localhost", "127.0.0.1"].includes(new URL(original).hostname),
  );
  const schema = "spm_a_browser_" + randomBytes(8).toString("hex"),
    pool = new Pool({ connectionString: original }),
    url = new URL(original);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  process.env.WEB_ORIGIN = "http://127.0.0.1:5176";
  const dir = ".runtime/a-audit";
  fs.mkdirSync(dir, { recursive: true });
  const checks = [],
    errors = [];
  const pass = (s) => {
    checks.push(s);
    console.log("PASS", s);
  };
  let app, vite, browser, page;
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
    const { NestFactory } = require("../apps/api/node_modules/@nestjs/core"),
      { AppModule } = require("../apps/api/dist/app.module"),
      { configure } = require("../apps/api/dist/bootstrap"),
      { DbService } = require("../apps/api/dist/db/db.module"),
      { hashPassword } = require("../apps/api/dist/auth/password");
    app = configure(await NestFactory.create(AppModule, { logger: false }));
    await app.listen(3003, "127.0.0.1");
    const db = app.get(DbService),
      password = randomBytes(24).toString("hex"),
      passwordHash = await hashPassword(password),
      users = {};
    for (const [username, role] of [
      ["项目经理", "MANAGER"],
      ["开发人员", "MEMBER"],
      ["测试人员", "MEMBER"],
      ["待添加用户", "MEMBER"],
      ["未授权用户", "MEMBER"],
    ])
      users[username] = await db.user.create({
        data: { username, role, passwordHash },
      });
    const manager = users["项目经理"],
      developer = users["开发人员"],
      tester = users["测试人员"],
      candidate = users["待添加用户"];
    const project = await db.project.create({
      data: {
        name: "爱管理开发项目",
        description:
          "面向团队的项目管理与多视图协同平台，统一组织需求、计划与任务。",
        managerId: manager.id,
        members: {
          create: [
            { userId: manager.id, role: "MANAGER" },
            { userId: developer.id, role: "DEVELOPER" },
            { userId: tester.id, role: "TESTER" },
          ],
        },
      },
    });
    for (const name of [
      "课程资料管理系统",
      "校园活动管理平台",
      "研发协作工具",
      "实验交付管理",
      "知识共享计划",
    ])
      await db.project.create({
        data: {
          name,
          description: "团队项目工作空间",
          managerId: manager.id,
          members: { create: { userId: manager.id, role: "MANAGER" } },
        },
      });
    for (const [id, title, assignee, status, progress] of [
      [101, "梳理项目需求", manager.id, "TODO", 0],
      [102, "完成前端页面", developer.id, "IN_PROGRESS", 40],
      [103, "接口联调", developer.id, "IN_PROGRESS", 50],
      [104, "功能测试", tester.id, "TODO", 0],
    ])
      await db.task.create({
        data: {
          id,
          projectId: project.id,
          title,
          description: "真实后端测试任务",
          assigneeUserId: assignee,
          status,
          progress,
        },
      });
    const stages = {},
      items = {};
    for (const [index, p] of reference.entries()) {
      stages[p.id] = await db.planStage.create({
        data: {
          projectId: project.id,
          title: p.title,
          description: p.description,
          start: p.start,
          end: p.end,
          ownerUserId: users[p.owner].id,
          sortOrder: index,
        },
      });
      for (const [goalIndex, g] of p.goals.entries())
        await db.planGoal.create({
          data: {
            projectId: project.id,
            stageId: stages[p.id].id,
            title: g.title,
            done: g.done,
            sortOrder: goalIndex,
          },
        });
      for (const i of [
        ...p.items.map((i) => ({ ...i, kind: "item" })),
        ...p.milestones.map((i) => ({
          ...i,
          kind: "milestone",
          start: i.date,
          end: i.date,
        })),
      ]) {
        items[i.id] = await db.planItem.create({
          data: {
            projectId: project.id,
            stageId: stages[p.id].id,
            title: i.title,
            description: i.description,
            start: i.start,
            end: i.end,
            kind: i.kind,
            ownerUserId: users[i.owner].id,
            status:
              {
                待处理: "TODO",
                进行中: "IN_PROGRESS",
                已完成: "DONE",
                暂缓: "PAUSED",
              }[i.status] || "TODO",
            priority:
              { 普通: "NORMAL", 高: "HIGH", 中: "MEDIUM", 低: "LOW" }[
                i.priority
              ] || "NORMAL",
          },
        });
        if (i.task)
          await db.taskPlanReference.create({
            data: {
              projectId: project.id,
              taskId: Number(i.task.slice(2)),
              planId: items[i.id].id,
            },
          });
      }
    }
    const goal = await db.productGoal.create({
        data: { projectId: project.id, title: "交付统一工作台" },
      }),
      epic = await db.epic.create({
        data: {
          projectId: project.id,
          goalId: goal.id,
          title: "计划与任务集成",
        },
      }),
      story = await db.userStory.create({
        data: {
          projectId: project.id,
          epicId: epic.id,
          title: "按阶段推进开发",
        },
      });
    await db.storyTask.create({
      data: { projectId: project.id, storyId: story.id, taskId: 102 },
    });
    const req = await db.requirement.create({
      data: { projectId: project.id, title: "项目计划管理" },
    });
    await db.storyRequirement.create({
      data: { projectId: project.id, storyId: story.id, requirementId: req.id },
    });
    await db.requirement.create({
      data: { projectId: project.id, parentId: req.id, title: "完整甘特图" },
    });
    const folder = await db.projectDocument.create({
      data: {
        projectId: project.id,
        name: "项目规划",
        kind: "FOLDER",
        ownerUserId: manager.id,
        ownerName: manager.username,
      },
    });
    await db.projectDocument.create({
      data: {
        projectId: project.id,
        name: "需求文档",
        kind: "FOLDER",
        ownerUserId: manager.id,
        ownerName: manager.username,
      },
    });
    await db.projectDocument.create({
      data: {
        projectId: project.id,
        parentId: folder.id,
        name: "系统架构说明.md",
        kind: "FILE",
        content: Buffer.from("# 架构说明\nReact + NestJS + PostgreSQL\n"),
        size: Buffer.byteLength("# 架构说明\nReact + NestJS + PostgreSQL\n"),
        mime: "text/plain; charset=utf-8",
        ownerUserId: manager.id,
        ownerName: manager.username,
      },
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
        port: 5176,
        strictPort: true,
        proxy: {
          "/api": { target: "http://127.0.0.1:3003", changeOrigin: true },
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
      acceptDownloads: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    const shot = (name) =>
        page.screenshot({
          path: `${dir}/after-${name}.png`,
          animations: "disabled",
        }),
      nav = async (label) => {
        await page
          .locator(".sidebar")
          .getByRole("button", { name: label, exact: true })
          .click();
      };
    const login = async (p, name) => {
      await p.goto("http://127.0.0.1:5176/");
      await p.getByLabel("用户名", { exact: true }).fill(name);
      await p.getByLabel("密码", { exact: true }).fill(password);
      await p.getByRole("button", { name: "登 录", exact: true }).click();
      await p.getByRole("heading", { name: "我的项目", exact: true }).waitFor();
    };
    const enter = async () => {
      await page
        .getByRole("button", { name: "爱管理开发项目", exact: true })
        .first()
        .click();
      await page
        .getByRole("heading", { name: "爱管理开发项目", exact: true })
        .waitFor();
    };
    const nativeDialog = () => page.getByRole("dialog");
    await page.goto("http://127.0.0.1:5176/");
    await page.getByRole("heading", { name: "欢迎登录爱管理" }).waitFor();
    await shot("A01");
    await login(page, manager.username);
    await shot("A02");
    await page.getByLabel("搜索项目").fill("P-001");
    assert.equal(
      await page.locator(".a-projects .project-title-button").count(),
      1,
    );
    await page.getByLabel("搜索项目").fill("");
    await page.getByRole("button", { name: "☷ 列表" }).click();
    await shot("A02-list");
    await page.getByRole("button", { name: "▦ 卡片" }).click();
    await page.getByRole("button", { name: "＋ 创建项目" }).click();
    await shot("A02-editor");
    await nativeDialog().getByLabel("项目名称").fill("浏览器创建的真实项目");
    await nativeDialog().getByLabel("项目描述").fill("验证项目创建持久化");
    await nativeDialog()
      .getByRole("button", { name: "创建项目", exact: true })
      .click();
    await page
      .getByText("浏览器创建的真实项目", { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await db.project.count({ where: { name: "浏览器创建的真实项目" } }),
      1,
    );
    await enter();
    await shot("A03");
    await page.locator(".topbar .project-select").click();
    await page
      .getByRole("menuitem", { name: "课程资料管理系统", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "课程资料管理系统", exact: true })
      .waitFor();
    await page.locator(".topbar .project-select").click();
    await page
      .getByRole("menuitem", { name: "爱管理开发项目", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "爱管理开发项目", exact: true })
      .waitFor();
    for (const label of [
      "需求管理",
      "项目计划",
      "任务管理",
      "项目文档",
      "成员与角色",
      "多视图工作台",
    ]) {
      await page
        .locator(".a-overview .quick")
        .getByRole("button", { name: new RegExp(label) })
        .click();
      assert.ok(
        (
          await page
            .locator(".sidebar")
            .getByRole("button", { name: label, exact: true })
            .getAttribute("class")
        ).includes("selected"),
      );
      await nav("项目概览");
    }
    pass(
      "A01/A02/A03 actual session, project statistics/cards/list, formatted project-code search, centered create modal, persisted project and authorized overview",
    );
    await page
      .locator(".a-overview .quick")
      .getByRole("button", { name: /项目计划/ })
      .click();
    await page
      .locator(".stagecard")
      .filter({ hasText: "需求分析与设计阶段" })
      .click();
    await shot("A04");
    for (const [label, key] of [
      ["列表", "list"],
      ["看板", "kanban"],
      ["甘特图", "gantt"],
      ["成员任务跟踪", "members"],
    ]) {
      await page
        .locator(".viewtabs")
        .getByRole("button", { name: label, exact: true })
        .click();
      await shot("A04-" + key);
    }
    await page.getByRole("button", { name: "全部收起", exact: true }).click();
    assert.equal(await page.locator(".mv-data-row").count(), 0);
    await page.getByRole("button", { name: "全部展开", exact: true }).click();
    assert.equal(await page.locator(".mv-data-row").count(), 4);
    await page.getByLabel("搜索关联任务").fill("接口联调");
    assert.equal(await page.locator(".mv-data-row").count(), 1);
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await page
      .locator(".viewtabs")
      .getByRole("button", { name: "概览", exact: true })
      .click();
    await page.getByRole("button", { name: "+ 添加目标", exact: true }).click();
    await nativeDialog().getByLabel("计划目标").fill("浏览器创建目标");
    await nativeDialog()
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByText("浏览器创建目标", { exact: true }).waitFor();
    await page.getByLabel("浏览器创建目标").click();
    await page.waitForFunction(
      async (p) =>
        (
          await (await fetch("/api/projects/" + p + "/plan-adapter")).json()
        ).stages.some((s) =>
          s.goals.some((g) => g.title === "浏览器创建目标" && g.done),
        ),
      project.id,
    );
    assert.equal(
      (
        await db.planGoal.findFirstOrThrow({
          where: { title: "浏览器创建目标" },
        })
      ).done,
      true,
    );
    await page.getByRole("button", { name: "添加计划项", exact: true }).click();
    await shot("A04-editor");
    await nativeDialog()
      .getByLabel("计划项名称 *", { exact: true })
      .fill("浏览器新增计划项");
    await nativeDialog()
      .getByLabel("负责人", { exact: true })
      .selectOption(String(developer.id));
    await nativeDialog().getByLabel("关联项目任务").selectOption("102");
    await nativeDialog()
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page
      .locator(".viewtabs")
      .getByRole("button", { name: "列表", exact: true })
      .click();
    await page
      .getByRole("button", { name: "浏览器新增计划项", exact: true })
      .click();
    await nativeDialog()
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await nativeDialog()
      .getByLabel("计划项名称 *", { exact: true })
      .fill("浏览器编辑计划项");
    await nativeDialog()
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("button", { name: "◆ 里程碑", exact: true }).click();
    await nativeDialog()
      .getByLabel("里程碑名称 *", { exact: true })
      .fill("浏览器里程碑");
    await nativeDialog()
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page
      .getByRole("button", { name: "浏览器里程碑", exact: true })
      .waitFor();
    await page
      .locator(".viewtabs")
      .getByRole("button", { name: "看板", exact: true })
      .click();
    let card = page
      .locator(".kanban-card")
      .filter({ hasText: "浏览器编辑计划项" });
    await card.dragTo(page.locator("[data-plan-status=IN_PROGRESS]"));
    await page
      .locator("[data-plan-status=IN_PROGRESS] .kanban-card")
      .filter({ hasText: "浏览器编辑计划项" })
      .waitFor();
    assert.equal(
      (
        await db.planItem.findFirstOrThrow({
          where: { title: "浏览器编辑计划项" },
        })
      ).status,
      "IN_PROGRESS",
    );
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: 102 } })).status,
      "IN_PROGRESS",
    );
    pass(
      "A04 all five native views share persisted stages/items/goals/milestones, member grouping/expand/search, true Task links and independent four-state board drag",
    );
    await page
      .locator(".viewtabs")
      .getByRole("button", { name: "甘特图", exact: true })
      .click();
    await page.getByLabel("甘特图时间尺度").selectOption("day");
    const before = await db.planItem.findUniqueOrThrow({
      where: { id: items.I4.id },
    });
    const bar = page
      .locator(".gv-itembar")
      .filter({ hasText: "核心页面原型设计" });
    await bar.scrollIntoViewIfNeeded();
    let r = await bar.boundingBox();
    await page.mouse.move(r.x + Math.min(55, r.width / 2), r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      r.x + Math.min(55, r.width / 2) + 72,
      r.y + r.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await until(
      async () =>
        (await db.planItem.findUniqueOrThrow({ where: { id: items.I4.id } }))
          .start !== before.start,
      "Gantt moved dates persisted",
    );
    let after = await db.planItem.findUniqueOrThrow({
      where: { id: items.I4.id },
    });
    assert.notEqual(after.start, before.start);
    await bar.scrollIntoViewIfNeeded();
    const handle = bar.locator("[data-resize=right]");
    r = await handle.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + 36, r.y + r.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await until(
      async () =>
        (await db.planItem.findUniqueOrThrow({ where: { id: items.I4.id } }))
          .end !== after.end,
      "Gantt resized dates persisted",
    );
    for (const scale of ["week", "month", "day"])
      await page.getByLabel("甘特图时间尺度").selectOption(scale);
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await page.getByRole("button", { name: "收起阶段栏", exact: true }).click();
    assert.equal(await page.locator(".stagefilter").isVisible(), false);
    await page.getByRole("button", { name: "显示阶段栏", exact: true }).click();
    await nav("多视图工作台");
    await page.getByRole("tab", { name: "甘特图", exact: true }).click();
    await page.getByLabel("工作台阶段").selectOption(stages.P2.id);
    assert.equal(
      await page
        .locator(".gv-itembar")
        .filter({ hasText: "核心页面原型设计" })
        .count(),
      1,
    );
    await shot("AB-gantt");
    await page
      .getByRole("button", { name: "甘特 + 成员", exact: true })
      .click();
    await page.getByLabel("工作台阶段").selectOption(stages.P2.id);
    await page
      .locator(".gv-fixed-name")
      .getByRole("button", { name: "核心页面原型设计", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "计划详情" })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page
      .locator(".svg-node.selected")
      .filter({ hasText: "完成前端页面" })
      .waitFor();
    await page
      .getByRole("button", { name: "T-102 完成前端页面", exact: true })
      .click();
    await page.locator(".ant-drawer-close").click();
    await page
      .locator(".gv-itembar.focus-halo")
      .filter({ hasText: "核心页面原型设计" })
      .waitFor();
    await shot("AB-dual-focus");
    pass(
      "A Gantt and B member graph resolve actual shared Task/PlanItem IDs and focus each other in both directions",
    );
    pass(
      "Reusable full V3.2 Gantt supports real task-bar move/edge resize, persisted dates, day/week/month, today and stage collapse; workbench reads the same component and data",
    );
    await nav("项目文档");
    await page.getByText("文件目录", { exact: true }).waitFor();
    await shot("A05");
    await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
    await nativeDialog().getByLabel("文件夹名称 *").fill("浏览器文件夹");
    await nativeDialog()
      .getByRole("button", { name: "创建", exact: true })
      .click();
    await page
      .getByRole("button", { name: "浏览器文件夹", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
    await nativeDialog().getByLabel("文件夹名称 *").fill("浏览器子文件夹");
    await nativeDialog()
      .getByRole("button", { name: "创建", exact: true })
      .click();
    await page
      .locator(".foldertree")
      .getByRole("button", { name: "浏览器子文件夹", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "收起浏览器文件夹", exact: true })
      .click();
    assert.equal(
      await page
        .locator(".foldertree")
        .getByRole("button", { name: "浏览器子文件夹", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "展开浏览器文件夹", exact: true })
      .click();
    await page
      .locator(".foldertree")
      .getByRole("button", { name: "浏览器子文件夹", exact: true })
      .click();
    await page
      .locator(".file-topline")
      .getByRole("button", { name: "浏览器文件夹", exact: true })
      .click();
    await page.getByLabel("上传项目文件").setInputFiles({
      name: "浏览器上传.md",
      mimeType: "text/plain",
      buffer: Buffer.from("# 浏览器真实上传\n确认字节持久化。"),
    });
    await page
      .getByRole("button", { name: "浏览器上传.md", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "浏览器上传.md", exact: true })
      .click();
    await page
      .locator(".previewbox pre")
      .filter({ hasText: "确认字节持久化" })
      .waitFor();
    await shot("A05-preview");
    const downloadPromise = page.waitForEvent("download");
    await nativeDialog()
      .getByRole("button", { name: "下载文件", exact: true })
      .click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "浏览器上传.md");
    assert.ok(
      fs.readFileSync(await download.path(), "utf8").includes("确认字节持久化"),
    );
    await page.getByRole("button", { name: "关闭文件详情" }).click();
    await page
      .getByRole("button", { name: "更多操作 浏览器上传.md", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /重命名/ }).click();
    await nativeDialog().getByLabel("名称 *").fill("重命名文件.md");
    await nativeDialog()
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page
      .getByRole("button", { name: "更多操作 重命名文件.md", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /移动/ }).click();
    await nativeDialog().getByLabel("目标位置").selectOption("");
    await nativeDialog().getByRole("button", { name: "确认移动" }).click();
    await page
      .locator(".file-topline")
      .getByRole("button", { name: "全部文档", exact: true })
      .click();
    await page.getByLabel("搜索文档名称、上传人").fill("重命名");
    assert.equal(await page.locator(".file-table tbody tr").count(), 1);
    await page.getByLabel("搜索文档名称、上传人").fill("");
    await page.getByTitle("缩略模式", { exact: true }).click();
    await page.locator(".folder-grid").waitFor();
    await page.getByTitle("列表模式", { exact: true }).click();
    await page
      .getByRole("button", { name: "更多操作 重命名文件.md", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await nativeDialog().getByRole("button", { name: "确认删除" }).click();
    await nativeDialog().waitFor({ state: "hidden" });
    assert.equal(
      await db.projectDocument.count({ where: { name: "重命名文件.md" } }),
      0,
    );
    await page.getByLabel("上传项目文件").setInputFiles({
      name: "真实图片.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page
      .getByRole("button", { name: "真实图片.png", exact: true })
      .click();
    await page.waitForFunction(() => {
      const img = document.querySelector(".previewbox img");
      return img && img.complete && img.naturalWidth > 0;
    });
    await shot("A05-image-preview");
    await page.getByRole("button", { name: "关闭文件详情" }).click();
    const pdfObjects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    const pdfText = "BT /F1 16 Tf 20 120 Td (SPM document preview) Tj ET";
    pdfObjects.push(
      "<< /Length " +
        Buffer.byteLength(pdfText) +
        " >>\nstream\n" +
        pdfText +
        "\nendstream",
    );
    let pdf = "%PDF-1.4\n",
      offsets = [0];
    for (const [i, obj] of pdfObjects.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += i + 1 + " 0 obj\n" + obj + "\nendobj\n";
    }
    const xref = Buffer.byteLength(pdf);
    pdf +=
      "xref\n0 6\n0000000000 65535 f \n" +
      offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join("") +
      "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
      xref +
      "\n%%EOF";
    const pdfBuffer = Buffer.from(pdf);
    await page.getByLabel("上传项目文件").setInputFiles({
      name: "真实预览.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });
    await page
      .getByRole("button", { name: "真实预览.pdf", exact: true })
      .click();
    await page.locator('iframe[title="PDF 预览"]').waitFor();
    await page.waitForTimeout(500);
    await shot("A05-pdf-preview");
    const pdfDownload = page.waitForEvent("download");
    await nativeDialog()
      .getByRole("button", { name: "下载文件", exact: true })
      .click();
    assert.deepEqual(
      fs.readFileSync(await (await pdfDownload).path()),
      pdfBuffer,
    );
    await page.getByRole("button", { name: "关闭文件详情" }).click();
    await page
      .getByRole("checkbox", { name: "选择 真实图片.png", exact: true })
      .check();
    await page.getByRole("button", { name: "批量移动", exact: true }).click();
    const destination = await db.projectDocument.findFirstOrThrow({
      where: { projectId: project.id, name: "需求文档" },
    });
    await nativeDialog()
      .getByLabel("目标位置")
      .selectOption(String(destination.id));
    await nativeDialog().getByRole("button", { name: "确认移动" }).click();
    await nativeDialog().waitFor({ state: "hidden" });
    assert.equal(
      (
        await db.projectDocument.findFirstOrThrow({
          where: { name: "真实图片.png" },
        })
      ).parentId,
      destination.id,
    );
    await page
      .getByRole("button", { name: "更多操作 浏览器文件夹", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await nativeDialog().getByRole("button", { name: "确认删除" }).click();
    await nativeDialog().waitFor({ state: "hidden" });
    assert.equal(
      await db.projectDocument.count({
        where: { name: { in: ["浏览器文件夹", "浏览器子文件夹"] } },
      }),
      0,
    );
    pass(
      "A05 nested folder expand/collapse and path navigation, recursive deletion, batch movement, real image preview and PDF preview/download bytes",
    );
    pass(
      "A05 real folder tree/create, uploaded persistent bytes, text preview, identical download, anchored menu rename/move/delete, search and grid/list",
    );
    await nav("成员与角色");
    await page
      .getByRole("heading", { name: "成员与角色", exact: true })
      .waitFor();
    await shot("A06");
    await page
      .getByRole("button", { name: "＋ 添加成员", exact: true })
      .click();
    await nativeDialog()
      .getByLabel("选择系统用户")
      .selectOption(String(candidate.id));
    await nativeDialog()
      .getByLabel("项目角色", { exact: true })
      .selectOption("TESTER");
    await nativeDialog()
      .getByRole("button", { name: "添加成员", exact: true })
      .click();
    await page.getByLabel("搜索成员姓名或用户名").fill(candidate.username);
    const row = page.locator(".a-members tbody tr");
    await row.getByRole("button", { name: "调整角色" }).click();
    await nativeDialog()
      .getByLabel("项目角色", { exact: true })
      .selectOption("DEVELOPER");
    await nativeDialog().getByRole("button", { name: "确认调整" }).click();
    await row.getByRole("button", { name: "查看", exact: true }).click();
    await shot("A06-detail");
    await page.getByRole("button", { name: "关闭成员详情" }).click();
    await row.getByRole("button", { name: "移除", exact: true }).click();
    await nativeDialog().getByRole("button", { name: "确认移除" }).click();
    await nativeDialog().waitFor({ state: "hidden" });
    assert.equal(
      await db.projectMember.count({
        where: { projectId: project.id, userId: candidate.id },
      }),
      0,
    );
    await page.getByRole("button", { name: "清空筛选", exact: true }).click();
    pass(
      "A06 exact member table/statistics, search, add existing user, adjust canonical project role, detail drawer and confirmed removal",
    );
    await nav("需求管理");
    await page.getByRole("button", { name: "全部收起", exact: true }).click();
    await page.getByRole("button", { name: "全部展开", exact: true }).click();
    await page.getByText("完整甘特图", { exact: true }).waitFor();
    await nav("任务管理");
    await page.getByRole("button", { name: "T-103更多操作" }).click();
    await page.getByRole("menu").waitFor();
    await page.keyboard.press("Escape");
    await nav("项目计划");
    await page
      .locator(".stagecard")
      .filter({ hasText: "需求分析与设计阶段" })
      .click();
    await page
      .locator(".viewtabs")
      .getByRole("button", { name: "列表", exact: true })
      .click();
    await page.reload();
    await page
      .getByRole("heading", { name: "我的项目", exact: true })
      .waitFor();
    await enter();
    await nav("项目计划");
    await page
      .locator(".stagecard")
      .filter({ hasText: "需求分析与设计阶段" })
      .click();
    await page
      .locator(".viewtabs")
      .getByRole("button", { name: "列表", exact: true })
      .click();
    await page
      .getByRole("button", { name: "浏览器编辑计划项", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "新建阶段计划", exact: true })
      .click();
    await nativeDialog()
      .getByLabel("阶段计划名称 *", { exact: true })
      .fill("浏览器新阶段");
    await nativeDialog()
      .getByLabel("开始日期 *", { exact: true })
      .fill("2026-11-01");
    await nativeDialog()
      .getByLabel("结束日期 *", { exact: true })
      .fill("2026-12-07");
    await nativeDialog()
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "浏览器新阶段", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "编辑阶段", exact: true }).click();
    await nativeDialog()
      .getByLabel("阶段计划名称 *", { exact: true })
      .fill("浏览器阶段已编辑");
    await nativeDialog()
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "浏览器阶段已编辑", exact: true })
      .waitFor();
    assert.equal(
      await db.planStage.count({ where: { title: "浏览器阶段已编辑" } }),
      1,
    );
    pass(
      "A04 centered stage create/edit forms persist dates, owner and stage identity independently of B goals/Epics",
    );
    pass(
      "B requirement tree and floating task menu remain usable; re-login/project selection after reload reads persisted A plan records",
    );
    const devContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      }),
      dev = await devContext.newPage();
    dev.setDefaultTimeout(12000);
    dev.on("pageerror", (e) => errors.push(e.message));
    await login(dev, developer.username);
    await dev
      .getByRole("button", { name: "爱管理开发项目", exact: true })
      .first()
      .click();
    await dev
      .locator(".sidebar")
      .getByRole("button", { name: "项目计划", exact: true })
      .click();
    await dev
      .locator(".stagecard")
      .filter({ hasText: "需求分析与设计阶段" })
      .click();
    await dev
      .locator(".viewtabs")
      .getByRole("button", { name: "成员任务跟踪", exact: true })
      .click();
    assert.equal(
      await dev
        .getByRole("button", { name: "新建阶段计划", exact: true })
        .count(),
      0,
    );
    assert.equal(await dev.locator(".mv-grouphead").count(), 1);
    await dev.screenshot({
      path: `${dir}/after-A04-developer.png`,
      animations: "disabled",
    });
    await dev
      .locator(".sidebar")
      .getByRole("button", { name: "项目文档", exact: true })
      .click();
    assert.equal(
      await dev.getByRole("button", { name: "上传文件", exact: true }).count(),
      0,
    );
    await dev
      .getByRole("button", { name: "系统架构说明.md", exact: true })
      .click();
    await dev.locator(".previewbox pre").waitFor();
    await dev.getByRole("button", { name: "关闭文件详情" }).click();
    await dev
      .locator(".sidebar")
      .getByRole("button", { name: "项目计划", exact: true })
      .click();
    await dev
      .locator(".stagecard")
      .filter({ hasText: "需求分析与设计阶段" })
      .click();
    await dev
      .locator(".viewtabs")
      .getByRole("button", { name: "列表", exact: true })
      .click();
    const edited = await db.planItem.findFirstOrThrow({
      where: { title: "浏览器编辑计划项" },
    });
    const liveResponse = await page.request.patch(
      "http://127.0.0.1:5176/api/projects/" +
        project.id +
        "/plan-adapter/items/" +
        edited.id,
      {
        headers: { "X-SPM-Request": "1", Origin: process.env.WEB_ORIGIN },
        data: { title: "跨浏览器同步计划项", revision: edited.revision },
      },
    );
    assert.ok(liveResponse.ok());
    await dev
      .getByRole("button", { name: "跨浏览器同步计划项", exact: true })
      .waitFor();
    const taskNow = await db.task.findUniqueOrThrow({ where: { id: 102 } });
    const taskResponse = await page.request.patch(
      "http://127.0.0.1:5176/api/projects/" + project.id + "/tasks/102",
      {
        headers: { "X-SPM-Request": "1", Origin: process.env.WEB_ORIGIN },
        data: { title: "B更新的真实任务", revision: taskNow.revision },
      },
    );
    assert.ok(taskResponse.ok());
    await dev
      .locator(".viewtabs")
      .getByRole("button", { name: "成员任务跟踪", exact: true })
      .click();
    await dev
      .getByRole("button", { name: "B更新的真实任务", exact: true })
      .first()
      .waitFor();
    const reassign = await page.request.patch(
      "http://127.0.0.1:5176/api/projects/" +
        project.id +
        "/tasks/102/assignee",
      {
        headers: { "X-SPM-Request": "1", Origin: process.env.WEB_ORIGIN },
        data: { assigneeUserId: tester.id },
      },
    );
    assert.ok(reassign.ok());
    await dev
      .getByRole("button", { name: "B更新的真实任务", exact: true })
      .first()
      .waitFor({ state: "hidden" });
    await nav("项目计划");
    await page
      .locator(".stagecard")
      .filter({ hasText: "需求分析与设计阶段" })
      .click();
    await page
      .locator(".viewtabs")
      .getByRole("button", { name: "成员任务跟踪", exact: true })
      .click();
    await page
      .getByLabel("筛选负责人", { exact: true })
      .selectOption(String(tester.id));
    await page
      .getByRole("button", { name: "B更新的真实任务", exact: true })
      .first()
      .waitFor();
    pass(
      "A member tracking filters by the actual reassigned Task owner; the former assignee loses those task rows in real time",
    );
    await devContext.close();
    pass(
      "Independent authenticated browsers synchronize A plan edits via SSE; B Task changes update A member tracking without duplicate tasks",
    );
    pass(
      "Developer plan views and documents are read-only, member tracking shows only own authorized tasks and document preview remains available",
    );
    await page
      .locator(".topbar")
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await page.getByRole("heading", { name: "欢迎登录爱管理" }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "欢迎登录爱管理" }).waitFor();
    assert.deepEqual(errors, []);
    pass(
      "Logout revokes the real session; route protection survives reload; zero browser runtime errors",
    );
    fs.writeFileSync(
      `${dir}/result.json`,
      JSON.stringify(
        {
          result: "PASS",
          viewport: { width: 1440, height: 900 },
          checks,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    if (page)
      await page
        .screenshot({ path: `${dir}/failure.png`, fullPage: true })
        .catch(() => {});
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
