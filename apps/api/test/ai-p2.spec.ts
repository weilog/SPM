import "reflect-metadata";
import "../src/environment";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer, Server } from "node:http";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { DbService } from "../src/db/db.module";
import { hashPassword } from "../src/auth/password";
import { AiConfig } from "../src/ai/ai.config";
import { Candidate } from "../src/ai/planning.service";

describe("P2 real PostgreSQL, transaction review, simulation and HTTP authorization", () => {
  let app: INestApplication,
    db: DbService,
    pool: Pool,
    gateway: Server,
    config: AiConfig;
  let p: number,
    other: number,
    req: number,
    task: number,
    goal: number,
    epic: number,
    story: number,
    stage: string,
    item: string,
    foreignReq: number;
  const ids: Record<string, number> = {},
    cookies: Record<string, string> = {},
    password = randomBytes(20).toString("hex");
  const schema = "spm_ai_p2_" + randomBytes(8).toString("hex"),
    original = process.env.DATABASE_URL!;
  const previousEnv = { ...process.env };
  let gatewayMode = "valid",
    requests = 0;
  const call = (
    m: "get" | "post" | "patch",
    path: string,
    who = "manager",
    data?: object,
  ) => {
    let r = request(app.getHttpServer())
      [m]("/api" + path)
      .set("X-SPM-Request", "1")
      .set("Origin", "http://127.0.0.1:5173");
    if (cookies[who]) r = r.set("Cookie", cookies[who]);
    return data ? r.send(data) : r;
  };
  const root = () => `/projects/${p}/ai`;
  const candidate = (
    key: string,
    kind: Candidate["kind"],
    extra: Partial<Candidate> = {},
  ): Candidate => ({
    key,
    kind,
    title: "Reviewed " + key,
    description: "Actual reviewed description",
    acceptanceCriteria: "Testable condition",
    action: "CREATE",
    reviewed: true,
    requirementKeys: [],
    storyKeys: [],
    planIds: [],
    priority: "MEDIUM",
    ...extra,
  });
  async function draft(items: Candidate[], title = "Review test") {
    const d = (
      await call("post", root() + "/drafts", "manager", { title }).expect(201)
    ).body;
    return (
      await call("patch", root() + "/drafts/" + d.id, "manager", {
        title,
        items,
        revision: d.revision,
      }).expect(200)
    ).body;
  }
  async function analyze(kind: string, scope: object = {}) {
    const { body: r } = await call("post", root() + "/analyses", "manager", {
      kind,
      ...scope,
      requestKey: randomUUID(),
    }).expect(201);
    let next;
    const end = Date.now() + 10000;
    do {
      next = (await call("get", root() + "/analyses/" + r.id).expect(200)).body;
      if (!["QUEUED", "RUNNING"].includes(next.status)) return next;
      await new Promise((r) => setTimeout(r, 25));
    } while (Date.now() < end);
    throw new Error("Worker timeout");
  }
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(original).hostname))
      throw new Error("Local real PostgreSQL required");
    pool = new Pool({ connectionString: original });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(original);
    url.searchParams.set("schema", schema);
    process.env.DATABASE_URL = url.toString();
    Object.assign(process.env, {
      AI_ENABLED: "true",
      AI_EXTERNAL_ENABLED: "false",
      AI_WORKER_POLL_MS: "25",
      AI_MAX_RUNS_PER_MINUTE: "1000",
      AI_MAX_RUNS_PER_PROJECT_24H: "10000",
      WEB_ORIGIN: "http://127.0.0.1:5173",
    });
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
    gateway = createServer(async (req, res) => {
      const parts = [];
      for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString());
      requests++;
      res.setHeader("Content-Type", "application/json");
      if (gatewayMode === "broken") {
        res.end("{bad");
        return;
      }
      if (body.input.context) {
        const data = body.input.context;
        const split = body.instructions.includes(
          "independent implementation TASK",
        );
        const items = split
          ? [candidate("split_one", "TASK", { storyKeys: [`story:${story}`] })]
          : [
              candidate("r", "REQUIREMENT"),
              candidate("s", "STORY", {
                epicKey: `epic:${epic}`,
                requirementKeys: ["r"],
              }),
              candidate("t", "TASK", { storyKeys: ["s"] }),
            ];
        if (!data.requirements || !data.tasks)
          throw new Error("No actual input data");
        res.end(JSON.stringify({ items }));
      } else
        res.end(
          JSON.stringify({
            explanations: body.input.findings.map((f: any) => ({
              eventKey: f.eventKey,
              explanation: "TEST_FIXTURE_INFERENCE",
              recommendation: "Review manually",
              evidenceKeys: f.evidence.map((e: any) => e.key),
            })),
          }),
        );
    });
    await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
    app = configure(
      (
        await Test.createTestingModule({ imports: [AppModule] }).compile()
      ).createNestApplication(),
    );
    await app.init();
    db = app.get(DbService);
    config = app.get(AiConfig);
    Object.assign(config, {
      externalEnabled: true,
      provider: "json-http",
      supplier: "LOCAL_TEST_FIXTURE",
      model: "NOT_REAL_AI",
      apiKey: "fixture-not-real",
      endpoint: `http://127.0.0.1:${(gateway.address() as { port: number }).port}`,
      approvedScope: "project-planning-v2",
      timeoutMs: 2000,
      maxInputBytes: 120000,
      maxOutputTokens: 3000,
      maxCalls24h: 1000,
    });
    const passwordHash = await hashPassword(password);
    for (const who of ["manager", "dev", "tester", "outsider", "admin"]) {
      ids[who] = (
        await db.user.create({
          data: {
            username: who,
            passwordHash,
            role:
              who === "manager"
                ? "MANAGER"
                : who === "admin"
                  ? "ADMIN"
                  : "MEMBER",
          },
        })
      ).id;
      const login = await call("post", "/auth/login", "", {
        username: who,
        password,
      }).expect(201);
      cookies[who] = login.headers["set-cookie"][0].split(";")[0];
    }
    p = (
      await db.project.create({
        data: {
          name: "P2 project",
          managerId: ids.manager,
          members: {
            create: [
              { userId: ids.manager, role: "MANAGER" },
              { userId: ids.dev, role: "DEVELOPER" },
              { userId: ids.tester, role: "TESTER" },
            ],
          },
        },
      })
    ).id;
    other = (
      await db.project.create({
        data: {
          name: "Other project",
          managerId: ids.manager,
          members: { create: { userId: ids.manager, role: "MANAGER" } },
        },
      })
    ).id;
    req = (
      await db.requirement.create({
        data: { projectId: p, title: "Existing requirement" },
      })
    ).id;
    foreignReq = (
      await db.requirement.create({
        data: { projectId: other, title: "Foreign requirement" },
      })
    ).id;
    goal = (
      await db.productGoal.create({
        data: { projectId: p, title: "Existing goal" },
      })
    ).id;
    epic = (
      await db.epic.create({
        data: { projectId: p, goalId: goal, title: "Existing Epic" },
      })
    ).id;
    story = (
      await db.userStory.create({
        data: { projectId: p, epicId: epic, title: "Existing story" },
      })
    ).id;
    task = (
      await db.task.create({
        data: {
          projectId: p,
          title: "Existing task",
          description: "Actual task detail",
          assigneeUserId: ids.dev,
        },
      })
    ).id;
    stage = (
      await db.planStage.create({
        data: {
          projectId: p,
          title: "Stage",
          start: "2020-01-01",
          end: "2020-01-31",
        },
      })
    ).id;
    item = (
      await db.planItem.create({
        data: {
          projectId: p,
          stageId: stage,
          title: "Plan item",
          start: "2020-01-02",
          end: "2020-01-03",
          ownerUserId: ids.dev,
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (app) await app.close();
    if (gateway) {
      gateway.closeAllConnections();
      await new Promise<void>((r) => gateway.close(() => r()));
    }
    for (const k of Object.keys(process.env))
      if (!(k in previousEnv)) delete process.env[k];
    Object.assign(process.env, previousEnv);
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
  afterEach(() => {
    gatewayMode = "valid";
  });
  it("queues real-data requirement generation but creates no business entities before explicit reviewed commit", async () => {
    const before = await db.requirement.count();
    const result = await analyze("PLANNING", {
      requestText: "Design access flow",
      requirementId: req,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.stale).toBe(false);
    expect(result.output.items).toHaveLength(3);
    expect(result.output.items.every((i: Candidate) => !i.reviewed)).toBe(true);
    expect(await db.requirement.count()).toBe(before);
    const d = (
      await call("post", root() + "/drafts", "manager", {
        title: "Generated requirement plan",
        runId: result.id,
      }).expect(201)
    ).body;
    await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
      revision: d.revision,
    }).expect(400);
    expect(await db.requirement.count()).toBe(before);
    await call("get", root() + "/analyses/" + result.id, "dev").expect(404);
    const history = (await call("get", root() + "/analyses", "dev").expect(200))
      .body;
    expect(history.items.some((r: any) => r.id === result.id)).toBe(false);
  });
  it("commits a three-level requirement tree, acceptance, story and independent TODO task through canonical services in one transaction", async () => {
    const d = await draft([
      candidate("r1", "REQUIREMENT"),
      candidate("r2", "REQUIREMENT", { parentKey: "r1" }),
      candidate("r3", "REQUIREMENT", { parentKey: "r2" }),
      candidate("s", "STORY", {
        epicKey: `epic:${epic}`,
        requirementKeys: ["r3"],
      }),
      candidate("t", "TASK", { storyKeys: ["s"], planIds: [item] }),
    ]);
    const { body: result } = await call(
      "post",
      root() + "/drafts/" + d.id + "/commit",
      "manager",
      { revision: d.revision },
    ).expect(201);
    expect(result.status).toBe("COMMITTED");
    const objects = result.result.objects;
    const r3 = objects.find((x: any) => x.key === "r3"),
      s = objects.find((x: any) => x.key === "s"),
      t = objects.find((x: any) => x.key === "t");
    expect(
      (await db.requirement.findUniqueOrThrow({ where: { id: r3.id } }))
        .acceptanceCriteria,
    ).toBe("Testable condition");
    expect(
      await db.storyRequirement.count({
        where: { storyId: s.id, requirementId: r3.id },
      }),
    ).toBe(1);
    expect(
      await db.task.findUniqueOrThrow({ where: { id: t.id } }),
    ).toMatchObject({ status: "TODO", progress: 0, assigneeUserId: null });
    expect(await db.taskHistory.count({ where: { taskId: t.id } })).toBe(1);
    expect(
      await db.taskPlanReference.count({
        where: { taskId: t.id, planId: item },
      }),
    ).toBe(1);
    await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
      revision: d.revision,
    }).expect(201);
    expect(await db.task.count({ where: { title: "Reviewed t" } })).toBe(1);
  });
  it.each(["missing_epic", "cross_project", "cycle", "four_levels"])(
    "rolls back all earlier writes for invalid %s candidates",
    async (mode) => {
      let items = [
        candidate("first", "REQUIREMENT"),
        candidate("bad", "STORY", {
          epicKey:
            mode === "cross_project"
              ? `epic:${foreignReq + 100000}`
              : undefined,
          requirementKeys: ["first"],
        }),
      ];
      if (mode === "cross_project")
        items = [
          candidate("first", "REQUIREMENT"),
          candidate("child", "REQUIREMENT", {
            parentKey: `requirement:${foreignReq}`,
          }),
        ];
      if (mode === "cycle")
        items = [
          candidate("first", "REQUIREMENT"),
          candidate("a", "REQUIREMENT", { parentKey: "b" }),
          candidate("b", "REQUIREMENT", { parentKey: "a" }),
        ];
      if (mode === "four_levels")
        items = [
          candidate("first", "REQUIREMENT"),
          candidate("b", "REQUIREMENT", { parentKey: "first" }),
          candidate("c", "REQUIREMENT", { parentKey: "b" }),
          candidate("d", "REQUIREMENT", { parentKey: "c" }),
        ];
      const d = await draft(items, "Invalid plan"),
        before = await db.requirement.count();
      await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
        revision: d.revision,
      }).expect(400);
      expect(await db.requirement.count()).toBe(before);
      expect(
        (await db.aiDraft.findUniqueOrThrow({ where: { id: d.id } })).status,
      ).toBe("DRAFT");
    },
  );
  it("rejects stale revisions and resets all approvals when references are explicitly revalidated", async () => {
    const d = await draft([candidate("a", "REQUIREMENT")]);
    await call("patch", `/projects/${p}/requirements/${req}`, "manager", {
      title: "Concurrent update",
      revision: 0,
    }).expect(200);
    expect(
      (await call("get", root() + "/drafts/" + d.id).expect(200)).body.stale,
    ).toBe(true);
    await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
      revision: d.revision,
    }).expect(409);
    const fresh = (
      await call(
        "post",
        root() + "/drafts/" + d.id + "/revalidate",
        "manager",
        { revision: d.revision },
      ).expect(201)
    ).body;
    expect(fresh.items.every((x: Candidate) => !x.reviewed)).toBe(true);
    await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
      revision: fresh.revision,
    }).expect(400);
    await call("patch", root() + "/drafts/" + d.id, "manager", {
      title: "Old write",
      revision: d.revision,
      items: d.items,
    }).expect(409);
  });
  it("supports explicit reuse, requirement-story linking and acceptance updates without duplicate objects", async () => {
    const d = await draft([
      candidate("r", "REQUIREMENT", {
        action: "UPDATE",
        existingId: req,
        acceptanceCriteria: "New reviewed acceptance",
      }),
      candidate("s", "STORY", {
        action: "REUSE",
        existingId: story,
        requirementKeys: ["r"],
      }),
    ]);
    const count = await db.userStory.count();
    await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
      revision: d.revision,
    }).expect(201);
    expect(await db.userStory.count()).toBe(count);
    expect(
      await db.storyRequirement.count({
        where: { storyId: story, requirementId: req },
      }),
    ).toBe(1);
    expect(
      (await db.requirement.findUniqueOrThrow({ where: { id: req } }))
        .acceptanceCriteria,
    ).toBe("New reviewed acceptance");
  });
  it("isolates drafts and write operations by project, author and current manager role", async () => {
    const d = await draft([candidate("private", "REQUIREMENT")]);
    for (const who of ["dev", "tester"]) {
      await call("get", root() + "/drafts", who).expect(403);
      await call("get", root() + "/drafts/" + d.id, who).expect(403);
      await call("post", root() + "/drafts/" + d.id + "/commit", who, {
        revision: d.revision,
      }).expect(403);
      await call("post", root() + "/analyses", who, {
        kind: "PLANNING",
        requestText: "Attempt",
      }).expect(403);
    }
    for (const who of ["outsider", "admin"])
      await call("get", root() + "/drafts", who).expect(404);
    await call("get", `/projects/${other}/ai/drafts/${d.id}`).expect(404);
    await call("post", root() + "/analyses", "manager", {
      kind: "PLANNING",
      requestText: "Attempt",
      requirementId: foreignReq,
    }).expect(404);
  });
  it("generates task-only proposals and requires manual approval before independent task creation", async () => {
    const run = await analyze("TASK_SPLIT", {
      taskId: task,
      requestText: "Split implementation safely",
    });
    expect(run.status).toBe("COMPLETED");
    expect(run.output.items.every((x: Candidate) => x.kind === "TASK")).toBe(
      true,
    );
    const d = (
      await call("post", root() + "/drafts", "manager", {
        title: "Task split",
        runId: run.id,
      }).expect(201)
    ).body;
    const saved = (
      await call("patch", root() + "/drafts/" + d.id, "manager", {
        revision: d.revision,
        title: d.title,
        items: d.items.map((x: Candidate) => ({ ...x, reviewed: true })),
      }).expect(200)
    ).body;
    await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
      revision: saved.revision,
    }).expect(201);
    expect(
      (
        await db.task.findFirstOrThrow({
          where: { projectId: p, title: "Reviewed split_one" },
        })
      ).status,
    ).toBe("TODO");
  });
  it("reuses task identity while merging reviewed references via canonical history and preserves owner/status fields", async () => {
    const t = await db.task.create({
      data: {
        projectId: p,
        title: "Keep original title",
        assigneeUserId: ids.dev,
      },
    });
    const d = await draft([
      candidate("reuse_t", "TASK", {
        action: "REUSE",
        existingId: t.id,
        title: "Do not overwrite title",
        assigneeUserId: ids.manager,
        storyKeys: [`story:${story}`],
        planIds: [item],
      }),
    ]);
    await call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
      revision: d.revision,
    }).expect(201);
    expect(
      await db.task.findUniqueOrThrow({ where: { id: t.id } }),
    ).toMatchObject({
      title: "Keep original title",
      assigneeUserId: ids.dev,
      status: "TODO",
    });
    expect(
      await db.storyTask.count({ where: { taskId: t.id, storyId: story } }),
    ).toBe(1);
    expect(await db.taskHistory.count({ where: { taskId: t.id } })).toBe(1);
  });
  it("coalesces concurrent commits into a single formal write", async () => {
    const d = await draft([
      candidate("once", "REQUIREMENT", { title: "Commit exactly once" }),
    ]);
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        call("post", root() + "/drafts/" + d.id + "/commit", "manager", {
          revision: d.revision,
        }).expect(201),
      ),
    );
    expect(
      new Set(responses.map((r) => r.body.result.objects[0].id)).size,
    ).toBe(1);
    expect(
      await db.requirement.count({
        where: { projectId: p, title: "Commit exactly once" },
      }),
    ).toBe(1);
  });
  it("keeps saved human edits unchanged when a new model generation fails", async () => {
    const d = await draft([
      candidate("human", "REQUIREMENT", { title: "Human edited text" }),
    ]);
    gatewayMode = "broken";
    const run = await analyze("PLANNING", { requestText: "Generate again" });
    expect(run.status).toBe("PARTIAL");
    expect(run.modelState).toBe("FORMAT_ERROR");
    expect(
      (await db.aiDraft.findUniqueOrThrow({ where: { id: d.id } })).items,
    ).toEqual(d.items);
    expect(requests).toBeGreaterThan(0);
  });
  it("simulates two candidate date sets with evidence without writing plans and rejects stale baselines", async () => {
    const run = await analyze("PLAN", { stageId: stage });
    const before = await db.planItem.findMany();
    const result = (
      await call("post", root() + `/analyses/${run.id}/scenarios`, "manager", {
        shifts: [3, 7],
      }).expect(201)
    ).body;
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].changes[0].revision).toBe(
      before.find((i) => i.id === item)!.revision,
    );
    expect(await db.planItem.findMany()).toEqual(before);
    await call("post", root() + `/analyses/${run.id}/scenarios`, "dev", {
      shifts: [3, 7],
    }).expect(403);
    await db.planItem.update({
      where: { id: item },
      data: { revision: { increment: 1 }, end: "2020-01-05" },
    });
    await call("post", root() + `/analyses/${run.id}/scenarios`, "manager", {
      shifts: [3, 7],
    }).expect(409);
  });
  it("keeps stale warnings on draft creation and save until explicit revalidation", async () => {
    gatewayMode = "valid";
    const run = await analyze("PLANNING", { requestText: "Stale recovery" });
    await db.requirement.update({
      where: { id: req },
      data: { revision: { increment: 1 } },
    });
    const d = (
      await call("post", root() + "/drafts", "manager", {
        title: "Old source",
        runId: run.id,
      }).expect(201)
    ).body;
    expect(d.stale).toBe(true);
    const saved = (
      await call("patch", root() + "/drafts/" + d.id, "manager", {
        title: "Human revision",
        revision: d.revision,
        items: d.items,
      }).expect(200)
    ).body;
    expect(saved.stale).toBe(true);
    const fresh = (
      await call("post", root() + `/drafts/${d.id}/revalidate`, "manager", {
        revision: saved.revision,
      }).expect(201)
    ).body;
    expect(
      (await call("get", root() + `/drafts/${d.id}`).expect(200)).body.stale,
    ).toBe(false);
    expect(fresh.items.every((i: Candidate) => !i.reviewed)).toBe(true);
  });
  it("finds health history beyond twenty other reports and paginates by kind without model calls", async () => {
    const callsBefore = requests;
    const health = await db.aiAnalysisRun.create({
      data: {
        projectId: p,
        requestedById: ids.manager,
        kind: "HEALTH",
        scope: {},
        requestKey: randomUUID(),
        requestHash: "history-fixture",
        rulesVersion: "history-fixture",
        status: "COMPLETED",
        createdAt: new Date("2021-01-01"),
      },
    });
    await db.aiAnalysisRun.createMany({
      data: Array.from({ length: 25 }, (_, n) => ({
        projectId: p,
        requestedById: ids.manager,
        kind: "TASK",
        scope: {},
        requestKey: randomUUID(),
        requestHash: "history-fixture",
        rulesVersion: "history-fixture",
        status: "COMPLETED",
        createdAt: new Date(Date.UTC(2022, 0, n + 1)),
      })),
    });
    const h = (
      await call("get", root() + "/analyses?kind=HEALTH&limit=20").expect(200)
    ).body;
    expect(h.items.some((r: any) => r.id === health.id)).toBe(true);
    expect(h.items.every((r: any) => r.kind === "HEALTH")).toBe(true);
    const one = (
      await call("get", root() + "/analyses?kind=TASK&limit=2").expect(200)
    ).body;
    const two = (
      await call(
        "get",
        root() + `/analyses?kind=TASK&limit=2&cursor=${one.nextCursor}`,
      ).expect(200)
    ).body;
    expect(one.items).toHaveLength(2);
    expect(two.items).toHaveLength(2);
    expect(
      two.items.every((r: any) => !one.items.some((a: any) => a.id === r.id)),
    ).toBe(true);
    await call(
      "get",
      root() + `/analyses?kind=TASK&cursor=${health.id}`,
    ).expect(404);
    await call("get", root() + "/analyses?kind=UNKNOWN").expect(400);
    await call("get", root() + "/analyses?kind=HEALTH", "outsider").expect(404);
    expect(requests).toBe(callsBefore);
  });
  it("keeps repeated concurrent history reads isolated without triggering model work", async () => {
    const callsBefore = requests;
    for (let batch = 0; batch < 4; batch++) {
      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, n) =>
          call(
            "get",
            root() + "/analyses?kind=HEALTH&limit=2",
            n % 2 ? "dev" : "manager",
          ).expect(200),
        ),
      );
      for (let n = 0; n < responses.length; n++)
        for (const r of responses[n].body.items) {
          expect(r.kind).toBe("HEALTH");
          if (n % 2) {
            expect(r.visibility).toBe("AUTHORIZED_FACTS_ONLY");
            expect(r.output).toBeUndefined();
            expect(r.modelInfo).toBeUndefined();
          }
        }
    }
    expect(requests).toBe(callsBefore);
  });
  it("rechecks downgraded manager permissions with the existing session", async () => {
    const d = await draft([candidate("revoked_manager", "REQUIREMENT")]);
    const count = await db.requirement.count();
    await db.projectMember.update({
      where: { projectId_userId: { projectId: p, userId: ids.manager } },
      data: { role: "DEVELOPER" },
    });
    try {
      await call("get", root() + `/drafts/${d.id}`).expect(403);
      await call("post", root() + `/drafts/${d.id}/commit`, "manager", {
        revision: d.revision,
      }).expect(403);
      await call("post", root() + "/analyses", "manager", {
        kind: "HEALTH",
      }).expect(403);
      expect(await db.requirement.count()).toBe(count);
    } finally {
      await db.projectMember.update({
        where: { projectId_userId: { projectId: p, userId: ids.manager } },
        data: { role: "MANAGER" },
      });
    }
  });
  it("resolves requirement evidence by real IDs, preserving existing cross-view task authorization", async () => {
    await db.storyTask.create({
      data: { projectId: p, storyId: story, taskId: task },
    });
    const r = (
      await call(
        "get",
        `/projects/${p}/relations/resolve?entityType=requirement&entityId=${req}`,
        "manager",
      ).expect(200)
    ).body;
    expect(r.requirements).toContain(req);
    expect(r.stories).toContain(story);
    expect(r.tasks).toContain(task);
    const t = (
      await call(
        "get",
        `/projects/${p}/relations/resolve?entityType=requirement&entityId=${req}`,
        "tester",
      ).expect(200)
    ).body;
    expect(t.tasks).not.toContain(task);
    await call(
      "get",
      `/projects/${p}/relations/resolve?entityType=requirement&entityId=${foreignReq}`,
    ).expect(404);
  });
});
