import "reflect-metadata";
import "../src/environment";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import request from "supertest";
import { WorkbenchService } from "../src/workbench/workbench.module";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { DbService } from "../src/db/db.module";
import { hashPassword } from "../src/auth/password";

describe("Workbench D1-D4 and UML sequences", () => {
  let app: INestApplication,
    db: DbService,
    pool: Pool,
    p: number,
    other: number,
    manager: number,
    developer: number,
    tester: number,
    foreign: number,
    stage: string,
    item: string,
    task: number;
  const schema = "spm_workbench_" + randomBytes(8).toString("hex"),
    original = process.env.DATABASE_URL!,
    password = randomBytes(24).toString("hex"),
    cookies: Record<string, string> = {};
  const call = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    who = "manager",
    data?: object,
  ) => {
    let r = request(app.getHttpServer())
      [method]("/api" + path)
      .set("X-SPM-Request", "1")
      .set("Origin", "http://127.0.0.1:5173");
    if (cookies[who]) r = r.set("Cookie", cookies[who]);
    return data ? r.send(data) : r;
  };
  const root = () => `/projects/${p}`,
    plans = () => root() + "/plan-adapter",
    docs = () => root() + "/documents";
  beforeAll(async () => {
    if (
      !original ||
      !["localhost", "127.0.0.1"].includes(new URL(original).hostname)
    )
      throw new Error("Local PostgreSQL required");
    pool = new Pool({ connectionString: original });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(original);
    url.searchParams.set("schema", schema);
    process.env.DATABASE_URL = url.toString();
    process.env.WEB_ORIGIN = "http://127.0.0.1:5173";
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--config",
        "prisma.config.ts",
      ],
      { env: process.env, stdio: "pipe" },
    );
    app = configure(
      (
        await Test.createTestingModule({ imports: [AppModule] }).compile()
      ).createNestApplication(),
    );
    await app.init();
    db = app.get(DbService);
    const passwordHash = await hashPassword(password);
    const ids: Record<string, number> = {};
    for (const name of [
      "manager",
      "developer",
      "tester",
      "foreign",
      "outsider",
      "admin",
    ]) {
      const u = await db.user.create({
        data: {
          username: name,
          passwordHash,
          role:
            name === "manager"
              ? "MANAGER"
              : name === "admin"
                ? "ADMIN"
                : "MEMBER",
        },
      });
      ids[name] = u.id;
      const login = await call("post", "/auth/login", "", {
        username: name,
        password,
      }).expect(201);
      cookies[name] = login.headers["set-cookie"][0].split(";")[0];
    }
    manager = ids.manager;
    developer = ids.developer;
    tester = ids.tester;
    foreign = ids.foreign;
    p = (
      await db.project.create({
        data: {
          name: "A integration project",
          managerId: manager,
          members: {
            create: [
              { userId: manager, role: "MANAGER" },
              { userId: developer, role: "DEVELOPER" },
              { userId: tester, role: "TESTER" },
            ],
          },
        },
      })
    ).id;
    other = (
      await db.project.create({
        data: {
          name: "Other",
          managerId: foreign,
          members: { create: { userId: foreign, role: "MANAGER" } },
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (app) await app.close();
    process.env.DATABASE_URL = original;
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  let storyId: number,
    useId: number,
    task2: number,
    item2: string,
    sequenceId: number;
  const sequence = () => ({
    name: "负责人分配",
    description: "设计场景",
    participants: [
      { id: "actor", name: "经理" },
      { id: "service", name: "任务服务" },
    ],
    messages: [
      { fromId: "actor", toId: "service", label: "调整负责人", kind: "call" },
    ],
    storyIds: [storyId],
    useCaseIds: [useId],
  });
  it("adds only empty sequence tables, preserving existing project data", async () => {
    expect(await db.project.count()).toBe(2);
    expect(
      (await call("get", root() + "/uml-sequences").expect(200)).body,
    ).toEqual([]);
    stage = (
      await call("post", plans() + "/stages", "manager", {
        title: "阶段",
        start: "2026-10-01",
        end: "2026-11-30",
      }).expect(201)
    ).body.id;
    item = (
      await call("post", plans() + "/items", "manager", {
        title: "计划一",
        stageId: stage,
        start: "2026-10-02",
        end: "2026-10-20",
      }).expect(201)
    ).body.id;
    item2 = (
      await call("post", plans() + "/items", "manager", {
        title: "计划二",
        stageId: stage,
        start: "2026-10-02",
        end: "2026-10-21",
      }).expect(201)
    ).body.id;
    const goal = await db.productGoal.create({
      data: { projectId: p, title: "目标" },
    });
    const epic = await db.epic.create({
      data: { projectId: p, goalId: goal.id, title: "Epic" },
    });
    storyId = (
      await db.userStory.create({
        data: { projectId: p, epicId: epic.id, title: "故事" },
      })
    ).id;
    task = (
      await call("post", root() + "/tasks", "manager", {
        title: "开发任务",
        assigneeUserId: developer,
        storyIds: [storyId],
        planIds: [item, item2],
      }).expect(201)
    ).body.id;
    task2 = (
      await call("post", root() + "/tasks", "manager", {
        title: "测试私有任务",
        assigneeUserId: tester,
        storyIds: [storyId],
      }).expect(201)
    ).body.id;
    const diagram = (
      await call("post", root() + "/uml-diagrams", "manager", {
        name: "用例",
      }).expect(201)
    ).body.id;
    useId = (
      await call("post", root() + `/uml-diagrams/${diagram}/nodes`, "manager", {
        kind: "USE_CASE",
        name: "分配负责人",
        x: 200,
        y: 100,
        storyIds: [storyId],
      }).expect(201)
    ).body.id;
  });
  it("persists typed scenario messages and many-to-many links without changing use cases", async () => {
    const before = await db.umlNode.findUniqueOrThrow({ where: { id: useId } });
    const actor = {
      id: manager,
      username: "manager",
      role: "MANAGER" as const,
      active: true,
    };
    const token = cookies.manager.slice(cookies.manager.indexOf("=") + 1);
    const beforeSignal = await app
      .get(WorkbenchService)
      .signal(actor, p, token);
    sequenceId = (
      await call(
        "post",
        root() + "/uml-sequences",
        "manager",
        sequence(),
      ).expect(201)
    ).body.id;
    expect(await app.get(WorkbenchService).signal(actor, p, token)).not.toBe(
      beforeSignal,
    );
    const saved = (await call("get", root() + "/uml-sequences").expect(200))
      .body[0];
    expect(saved.storyIds).toEqual([storyId]);
    expect(saved.useCaseIds).toEqual([useId]);
    expect(saved.messages[0].label).toBe("调整负责人");
    expect(
      await db.umlNode.findUniqueOrThrow({ where: { id: useId } }),
    ).toEqual(before);
    await call("patch", root() + `/uml-sequences/${sequenceId}`, "manager", {
      ...sequence(),
      revision: 0,
      name: "更新场景",
    }).expect(200);
    await call("patch", root() + `/uml-sequences/${sequenceId}`, "manager", {
      ...sequence(),
      revision: 0,
    }).expect(409);
  });
  it("rejects invalid message references, participant duplicates, cross-project and actor links atomically", async () => {
    const n = await db.umlSequence.count();
    await call("post", root() + "/uml-sequences", "manager", {
      ...sequence(),
      messages: [
        { fromId: "missing", toId: "actor", label: "非法", kind: "call" },
      ],
    }).expect(400);
    await call("post", root() + "/uml-sequences", "manager", {
      ...sequence(),
      participants: [
        { id: "same", name: "甲" },
        { id: "same", name: "乙" },
      ],
    }).expect(400);
    await call("post", root() + "/uml-sequences", "manager", {
      ...sequence(),
      storyIds: [999999],
    }).expect(400);
    expect(await db.umlSequence.count()).toBe(n);
    expect(
      (
        await call("get", `/projects/${other}/uml-sequences`, "foreign").expect(
          200,
        )
      ).body,
    ).toEqual([]);
    await call(
      "patch",
      `/projects/${other}/uml-sequences/${sequenceId}`,
      "foreign",
      { ...sequence(), revision: 1 },
    ).expect(404);
  });
  it("returns exact direct plan/member relations and labels indirect paths without sibling-task expansion", async () => {
    const trace = (
      await call(
        "get",
        root() +
          `/relations/resolve?mode=trace&entityType=task&entityId=${task}`,
      ).expect(200)
    ).body;
    expect(trace.planItems.sort()).toEqual([item, item2].sort());
    expect(trace.tasks).toEqual([task]);
    expect(
      trace.trace.find(
        (t: any) => t.entityType === "member" && t.entityId === developer,
      ).distance,
    ).toBe(1);
    expect(
      trace.trace.find((t: any) => t.entityType === "umlUseCase").distance,
    ).toBe(2);
    expect(trace.sequences).toContain(sequenceId);
    const reverse = (
      await call(
        "get",
        root() +
          `/relations/resolve?mode=trace&entityType=member&entityId=${developer}`,
      ).expect(200)
    ).body;
    expect(reverse.tasks).toEqual([task]);
    const legacy = (
      await call(
        "get",
        root() + `/relations/resolve?entityType=task&entityId=${task}`,
      ).expect(200)
    ).body;
    expect(legacy.tasks).toContain(task2);
  });
  it("filters private tasks and member nodes and rejects member writes and outsider reads", async () => {
    const trace = (
      await call(
        "get",
        root() +
          `/relations/resolve?mode=trace&entityType=story&entityId=${storyId}`,
        "developer",
      ).expect(200)
    ).body;
    expect(trace.tasks).toEqual([task]);
    expect(trace.members).toEqual([developer]);
    expect(JSON.stringify(trace)).not.toContain("测试私有任务");
    await call(
      "get",
      root() +
        `/relations/resolve?mode=trace&entityType=task&entityId=${task2}`,
      "developer",
    ).expect(404);
    await call(
      "get",
      root() +
        `/relations/resolve?mode=trace&entityType=member&entityId=${tester}`,
      "developer",
    ).expect(404);
    await call(
      "post",
      root() + "/uml-sequences",
      "developer",
      sequence(),
    ).expect(403);
    await call(
      "delete",
      root() + `/uml-sequences/${sequenceId}?revision=1`,
      "developer",
    ).expect(403);
    await call("get", root() + "/uml-sequences", "outsider").expect(404);
    await call("get", root() + "/uml-sequences", "admin").expect(404);
  });
  it("keeps object states independent and enforces assignment revision conflicts", async () => {
    const beforeTask = await db.task.findUniqueOrThrow({ where: { id: task } });
    const beforeStory = await db.userStory.findUniqueOrThrow({
      where: { id: storyId },
    });
    const plan = await db.planItem.findUniqueOrThrow({ where: { id: item } });
    await call("patch", plans() + `/items/${item}`, "manager", {
      revision: plan.revision,
      start: "2026-10-03",
    }).expect(200);
    expect(await db.task.findUniqueOrThrow({ where: { id: task } })).toEqual(
      beforeTask,
    );
    await call("patch", root() + `/tasks/${task}/assignee`, "manager", {
      revision: beforeTask.revision,
      assigneeUserId: tester,
    }).expect(200);
    await call("patch", root() + `/tasks/${task}/assignee`, "manager", {
      revision: beforeTask.revision,
      assigneeUserId: developer,
    }).expect(409);
    expect(
      await db.userStory.findUniqueOrThrow({ where: { id: storyId } }),
    ).toEqual(beforeStory);
    const afterPlan = await db.planItem.findUniqueOrThrow({
      where: { id: item },
    });
    expect(afterPlan.ownerUserId).toBe(plan.ownerUserId);
    expect(afterPlan.status).toBe(plan.status);
    expect(await db.taskPlanReference.count({ where: { taskId: task } })).toBe(
      2,
    );
  });
  it("deletes only the scenario and its own links", async () => {
    const rows = (await call("get", root() + "/uml-sequences").expect(200))
      .body;
    expect(rows[0].revision).toBe(1);
    const before = [
      await db.task.count(),
      await db.userStory.count(),
      await db.umlNode.count(),
      await db.planItem.count(),
    ];
    await call(
      "delete",
      root() + `/uml-sequences/${sequenceId}?revision=0`,
    ).expect(409);
    await call(
      "delete",
      root() + `/uml-sequences/${sequenceId}?revision=1`,
    ).expect(200);
    expect(await db.umlSequenceStory.count()).toBe(0);
    expect(await db.umlSequenceUseCase.count()).toBe(0);
    expect([
      await db.task.count(),
      await db.userStory.count(),
      await db.umlNode.count(),
      await db.planItem.count(),
    ]).toEqual(before);
  });
});
