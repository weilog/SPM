import "reflect-metadata";
import "../src/environment";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { createServer, Server } from "node:http";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { DbService } from "../src/db/db.module";
import { hashPassword } from "../src/auth/password";
import { AiConfig } from "../src/ai/ai.config";
import { RULES_VERSION } from "../src/ai/ai.types";

// Real PostgreSQL, Nest HTTP routes, sessions and worker. The local HTTP gateway
// below is explicitly a test fixture, NOT a real AI supplier or production Stub.
describe("P1 AI foundation: real database and authorized HTTP execution", () => {
  let app: INestApplication,
    db: DbService,
    config: AiConfig,
    pool: Pool,
    gateway: Server;
  let p: number,
    foreignProject: number,
    stage: string,
    ownTask: number,
    secretTask: number,
    foreignTask: number;
  let parent: number, leaf: number, reportId: string, endpoint: string;
  let mode = "success",
    calls = 0,
    sentBodies: any[] = [];
  let release: (() => void) | undefined;
  const schema = "spm_ai_" + randomBytes(8).toString("hex");
  const original = process.env.DATABASE_URL!;
  const savedEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.startsWith("AI_")),
  );
  const password = randomBytes(24).toString("hex");
  const cookies: Record<string, string> = {},
    ids: Record<string, number> = {};
  const api = (
    method: "get" | "post" | "patch",
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
  const root = () => `/projects/${p}/ai`,
    runs = () => root() + "/analyses";
  async function boot() {
    app = configure(
      (
        await Test.createTestingModule({ imports: [AppModule] }).compile()
      ).createNestApplication(),
    );
    await app.init();
    db = app.get(DbService);
    config = app.get(AiConfig);
  }
  async function finish(id: string) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const row = await db.aiAnalysisRun.findUniqueOrThrow({ where: { id } });
      if (!["QUEUED", "RUNNING"].includes(row.status))
        return (await api("get", runs() + "/" + id).expect(200)).body;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("AI worker did not finish " + id);
  }
  async function analyze(kind = "CROSS_VIEW", extra: object = {}) {
    const r = await api("post", runs(), "manager", {
      kind,
      requestKey: randomUUID(),
      ...extra,
    }).expect(201);
    return finish(r.body.id);
  }
  function external(enabled = true) {
    Object.assign(config, {
      externalEnabled: enabled,
      provider: "json-http",
      supplier: "LOCAL_TEST_FIXTURE",
      model: "TEST_NOT_REAL_AI",
      apiKey: "test-only-secret",
      endpoint,
      approvedScope: "project-evidence-v1",
      maxCalls24h: 10000,
      timeoutMs: 1500,
      maxInputBytes: 120000,
    });
  }
  beforeAll(async () => {
    if (
      !original ||
      !["localhost", "127.0.0.1"].includes(new URL(original).hostname)
    )
      throw new Error("Real local PostgreSQL required");
    pool = new Pool({ connectionString: original });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(original);
    url.searchParams.set("schema", schema);
    process.env.DATABASE_URL = url.toString();
    for (const k of Object.keys(process.env))
      if (k.startsWith("AI_")) delete process.env[k];
    Object.assign(process.env, {
      AI_ENABLED: "true",
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
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(Buffer.from(part));
      const body = JSON.parse(Buffer.concat(parts).toString());
      calls++;
      sentBodies.push(body);
      if (mode === "transport") {
        req.socket.destroy();
        return;
      }
      if (req.headers.authorization !== "Bearer test-only-secret") {
        res.writeHead(401).end();
        return;
      }
      if (mode === "wait")
        await new Promise<void>((r) => {
          release = r;
        });
      if (mode === "timeout") await new Promise((r) => setTimeout(r, 300));
      if (mode === "http") {
        res.writeHead(503).end("never expose upstream secret");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (mode === "malformed") {
        res.end("{bad json");
        return;
      }
      if (mode === "oversized") {
        res.end(" ".repeat(70000));
        return;
      }
      const explanations = body.input.findings.map((f: any) => ({
        eventKey: f.eventKey,
        explanation: "TEST inference including private manager-only narrative",
        recommendation: "Review in original editor; no automatic write.",
        evidenceKeys: f.evidence.map((e: any) => e.key),
      }));
      if (mode === "spoof" && explanations[0])
        explanations[0].evidenceKeys = ["task:999999"];
      res.end(
        JSON.stringify({
          explanations: mode === "incomplete" ? [] : explanations,
        }),
      );
    });
    await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
    await boot();
    const passwordHash = await hashPassword(password);
    for (const name of ["manager", "dev", "tester", "outsider", "admin"]) {
      ids[name] = (
        await db.user.create({
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
        })
      ).id;
      const r = await api("post", "/auth/login", "", {
        username: name,
        password,
      }).expect(201);
      cookies[name] = r.headers["set-cookie"][0].split(";")[0];
    }
    p = (
      await db.project.create({
        data: {
          name: "P1 real authorized project",
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
    foreignProject = (
      await db.project.create({
        data: {
          name: "Different project",
          managerId: ids.manager,
          members: { create: { userId: ids.manager, role: "MANAGER" } },
        },
      })
    ).id;
    stage = (
      await db.planStage.create({
        data: {
          projectId: p,
          title: "Historical stage",
          start: "2020-01-01",
          end: "2020-01-31",
        },
      })
    ).id;
    for (const [i, kind, start, end] of [
      [0, "item", "2020-01-02", "2020-01-10"],
      [1, "item", "2020-01-05", "2020-02-01"],
      [2, "milestone", "2020-01-31", "2020-01-31"],
    ] as const)
      await db.planItem.create({
        data: {
          projectId: p,
          stageId: stage,
          title: "Plan " + i,
          kind,
          start,
          end,
          ownerUserId: ids.dev,
        },
      });
    for (let i = 0; i < 3; i++) {
      const t = await db.task.create({
        data: {
          projectId: p,
          title: "Developer visible " + i,
          priority: "HIGH",
          assigneeUserId: ids.dev,
        },
      });
      if (i === 0) ownTask = t.id;
    }
    secretTask = (
      await db.task.create({
        data: {
          projectId: p,
          title: "SECRET_OTHER_MEMBER_TASK",
          assigneeUserId: ids.tester,
        },
      })
    ).id;
    await db.task.create({
      data: { projectId: p, title: "Unassigned manager-only task" },
    });
    foreignTask = (
      await db.task.create({
        data: { projectId: foreignProject, title: "FOREIGN_PROJECT_SECRET" },
      })
    ).id;
    parent = (
      await db.requirement.create({
        data: { projectId: p, title: "Parent should not be flagged" },
      })
    ).id;
    leaf = (
      await db.requirement.create({
        data: { projectId: p, title: "Leaf without story", parentId: parent },
      })
    ).id;
    const goal = await db.productGoal.create({
      data: { projectId: p, title: "Goal" },
    });
    const epic = await db.epic.create({
      data: { projectId: p, goalId: goal.id, title: "Epic" },
    });
    await db.userStory.create({
      data: {
        projectId: p,
        epicId: epic.id,
        title: "Story without requirement or use case",
      },
    });
  }, 30000);
  afterAll(async () => {
    release?.();
    if (app) await app.close();
    if (gateway) {
      gateway.closeAllConnections();
      await new Promise<void>((r) => gateway.close(() => r()));
    }
    process.env.DATABASE_URL = original;
    for (const k of Object.keys(process.env))
      if (k.startsWith("AI_")) delete process.env[k];
    Object.assign(process.env, savedEnv);
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
  afterEach(() => {
    if (!config) return;
    external(false);
    mode = "success";
    Object.assign(config, {
      maxRunsMinute: 1000,
      maxRetries: 2,
      maxFindings: 300,
      enabled: true,
    });
  });

  it("manually queues rules-only work, persists evidence, deduplicates dimensions and never changes business data", async () => {
    const before = await Promise.all([
      db.task.findMany(),
      db.requirement.findMany(),
      db.planItem.findMany(),
      db.userStory.findMany(),
    ]);
    const report = await analyze();
    reportId = report.id;
    writeFileSync(
      resolve("../../.runtime/ai-p1-manager-report.json"),
      JSON.stringify(
        {
          fixture: "REAL_POSTGRES_RULES_ONLY_TEST",
          request: { kind: "CROSS_VIEW" },
          response: report,
        },
        null,
        2,
      ),
    );
    expect(report.status).toBe("PARTIAL");
    expect(report.modelState).toBe("NOT_CONFIGURED");
    expect(calls).toBe(0);
    expect(report.stale).toBe(false);
    expect(report.findings.length).toBeGreaterThan(7);
    expect(
      report.findings.some(
        (f: any) =>
          f.ruleId === "LEAF_REQUIREMENT_WITHOUT_STORY" &&
          f.evidence[0].entityId === leaf,
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (f: any) =>
          f.ruleId === "LEAF_REQUIREMENT_WITHOUT_STORY" &&
          f.evidence[0].entityId === parent,
      ),
    ).toBe(false);
    const unassigned = report.findings.filter(
      (f: any) => f.ruleId === "TASK_UNASSIGNED",
    );
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].dimensions).toEqual(["PROGRESS", "ALLOCATION"]);
    expect(new Set(report.findings.map((f: any) => f.eventKey)).size).toBe(
      report.summary.uniqueEvents,
    );
    expect(
      report.findings.every((f: any) => f.evidence.length && f.evidenceCurrent),
    ).toBe(true);
    expect(
      await Promise.all([
        db.task.findMany(),
        db.requirement.findMany(),
        db.planItem.findMany(),
        db.userStory.findMany(),
      ]),
    ).toEqual(before);
    const columns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='Requirement'",
      [schema],
    );
    expect(columns.rows.map((r) => r.column_name)).toContain("revision");
    expect(columns.rows.map((r) => r.column_name)).toContain(
      "acceptanceCriteria",
    );
  });
  it("filters findings before counting and omits full report/model information for normal members", async () => {
    for (const who of ["dev", "tester"]) {
      const { body: r } = await api("get", runs() + "/" + reportId, who).expect(
        200,
      );
      expect(r.visibility).toBe("AUTHORIZED_FACTS_ONLY");
      expect(r.summary.uniqueEvents).toBe(r.findings.length);
      const dimensions: Record<string, number> = {};
      for (const f of r.findings)
        for (const d of f.dimensions) dimensions[d] = (dimensions[d] || 0) + 1;
      expect(r.summary.dimensions).toEqual(dimensions);
      expect(r).not.toHaveProperty("modelState");
      expect(r).not.toHaveProperty("sourceHash");
      expect(r.findings.every((f: any) => !("inference" in f))).toBe(true);
      if (who === "dev")
        writeFileSync(
          resolve("../../.runtime/ai-p1-member-report.json"),
          JSON.stringify(
            { fixture: "REAL_POSTGRES_RULES_ONLY_TEST", response: r },
            null,
            2,
          ),
        );
      const text = JSON.stringify(r);
      expect(text).not.toContain("Unassigned manager-only");
      expect(text).not.toContain(
        who === "dev" ? "SECRET_OTHER_MEMBER_TASK" : "Developer visible",
      );
    }
    const cap = await api("get", root() + "/capabilities", "dev").expect(200);
    expect(cap.body.canAnalyze).toBe(false);
  });
  it("enforces authentication, current project roles, scoped ownership and project isolation", async () => {
    await api("get", runs(), "").expect(401);
    for (const who of ["outsider", "admin"])
      await api("get", runs(), who).expect(404);
    for (const who of ["dev", "tester"]) {
      await api("post", runs(), who, { kind: "HEALTH" }).expect(403);
      await api("post", runs() + "/" + reportId + "/retry", who, {}).expect(
        403,
      );
    }
    await api("post", runs(), "manager", {
      kind: "TASK",
      taskId: foreignTask,
    }).expect(404);
    await api("post", runs(), "manager", {
      kind: "HEALTH",
      actorId: ids.manager,
    }).expect(400);
    await api("post", runs(), "manager", {
      kind: "HEALTH",
      stageId: stage,
    }).expect(400);
    await api(
      "get",
      `/projects/${foreignProject}/ai/analyses/${reportId}`,
    ).expect(404);
    await api(
      "get",
      `/projects/${foreignProject}/ai/analyses?cursor=${reportId}`,
    ).expect(404);
    const scoped = await analyze("TASK", { taskId: secretTask });
    await api("get", runs() + "/" + scoped.id, "dev").expect(404);
    const h = await api("get", runs() + "?limit=20", "dev").expect(200);
    expect(h.body.items.some((x: any) => x.id === scoped.id)).toBe(false);
    await db.user.update({ where: { id: ids.dev }, data: { active: false } });
    await api("get", runs() + "/" + reportId, "dev").expect(401);
    await db.user.update({ where: { id: ids.dev }, data: { active: true } });
    const login = await api("post", "/auth/login", "", {
      username: "dev",
      password,
    }).expect(201);
    cookies.dev = login.headers["set-cookie"][0].split(";")[0];
  });
  it("coalesces concurrent idempotent requests and rejects conflicting reuse", async () => {
    const key = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        api("post", runs(), "manager", {
          kind: "HEALTH",
          requestKey: key,
        }).expect(201),
      ),
    );
    expect(new Set(replies.map((x) => x.body.id)).size).toBe(1);
    await finish(replies[0].body.id);
    expect(
      await db.aiAnalysisRun.count({
        where: { projectId: p, requestKey: key },
      }),
    ).toBe(1);
    await api("post", runs(), "manager", {
      kind: "PLAN",
      requestKey: key,
    }).expect(409);
  });
  it("marks old sources stale without automatically invoking provider; retry creates a distinct immutable report", async () => {
    const old = await db.aiAnalysisRun.findUniqueOrThrow({
      where: { id: reportId },
    });
    const count = calls;
    const task = await db.task.findUniqueOrThrow({ where: { id: ownTask } });
    await api("patch", `/projects/${p}/tasks/${ownTask}`, "manager", {
      title: "Updated current task",
      revision: task.revision,
    }).expect(200);
    const { body: stale } = await api("get", runs() + "/" + reportId).expect(
      200,
    );
    expect(stale.stale).toBe(true);
    await api("get", runs()).expect(200);
    expect(calls).toBe(count);
    const retry = await api(
      "post",
      runs() + "/" + reportId + "/retry",
      "manager",
      { requestKey: randomUUID() },
    ).expect(201);
    expect(retry.body.id).not.toBe(reportId);
    const fresh = await finish(retry.body.id);
    expect(fresh.stale).toBe(false);
    expect(
      (await db.aiAnalysisRun.findUniqueOrThrow({ where: { id: reportId } }))
        .sourceHash,
    ).toBe(old.sourceHash);
    const second = await api(
      "post",
      runs() + "/" + retry.body.id + "/retry",
      "manager",
      {},
    ).expect(201);
    await finish(second.body.id);
    await api(
      "post",
      runs() + "/" + second.body.id + "/retry",
      "manager",
      {},
    ).expect(400);
  });
  it("uses the real HTTP adapter with a declared test gateway and validates evidence-linked inference", async () => {
    external();
    const report = await analyze();
    expect(report.status).toBe("COMPLETED");
    expect(report.modelState).toBe("SUCCEEDED");
    expect(report.modelInfo.supplier).toBe("LOCAL_TEST_FIXTURE");
    expect(report.findings.some((f: any) => f.inference)).toBe(true);
    const sent = JSON.stringify(sentBodies.at(-1));
    expect(sent).not.toContain("password");
    expect(sent).not.toContain("email");
    expect(sent).not.toContain("passwordHash");
    expect(sentBodies.at(-1).input.scope).toBe("project-evidence-v1");
    const { body: member } = await api(
      "get",
      runs() + "/" + report.id,
      "dev",
    ).expect(200);
    expect(JSON.stringify(member)).not.toContain(
      "private manager-only narrative",
    );
    await api(
      "post",
      runs() + "/" + report.id + "/retry",
      "manager",
      {},
    ).expect(400);
  });
  it.each([
    ["malformed", "FORMAT_ERROR"],
    ["transport", "TRANSPORT_ERROR"],
    ["spoof", "FORMAT_ERROR"],
    ["oversized", "FORMAT_ERROR"],
    ["http", "HTTP_ERROR"],
    ["timeout", "TIMEOUT"],
    ["incomplete", "INCOMPLETE_OUTPUT"],
  ])("retains rule evidence on %s model failures", async (m, state) => {
    external();
    mode = m;
    if (m === "timeout") Object.assign(config, { timeoutMs: 75 });
    const r = await analyze("HEALTH");
    expect(r.status).toBe("PARTIAL");
    expect(r.modelState).toBe(state);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain("never expose upstream secret");
    expect(JSON.stringify(r)).not.toContain("test-only-secret");
  });
  it("bounds input, rule output, model budget and manual run rate explicitly", async () => {
    external();
    Object.assign(config, { maxInputBytes: 1024 });
    const before = calls;
    expect((await analyze()).modelState).toBe("INPUT_TOO_LARGE");
    expect(calls).toBe(before);
    Object.assign(config, { maxInputBytes: 120000, maxCalls24h: 1 });
    expect((await analyze()).modelState).toBe("BUDGET_EXCEEDED");
    expect(calls).toBe(before);
    external(false);
    Object.assign(config, { maxFindings: 1 });
    const limited = await analyze();
    expect(limited.errorCode).toBe("RULE_OUTPUT_LIMIT");
    expect(limited.modelInfo.rulesTruncated).toBe(true);
    Object.assign(config, { maxRunsMinute: 1 });
    await api("post", runs(), "manager", { kind: "HEALTH" }).expect(429);
  });
  it("checks manager role again before publishing results if permissions were revoked during model execution", async () => {
    external();
    mode = "wait";
    release = undefined;
    const { body: r } = await api("post", runs(), "manager", {
      kind: "HEALTH",
    }).expect(201);
    const until = Date.now() + 5000;
    while (!release && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    expect(release).toBeDefined();
    await db.projectMember.update({
      where: { projectId_userId: { projectId: p, userId: ids.manager } },
      data: { role: "DEVELOPER" },
    });
    release!();
    const deadline = Date.now() + 5000;
    let row;
    do {
      row = await db.aiAnalysisRun.findUniqueOrThrow({ where: { id: r.id } });
      if (row.status === "CANCELLED") break;
      await new Promise((r) => setTimeout(r, 25));
    } while (Date.now() < deadline);
    expect(row!.status).toBe("CANCELLED");
    expect(row!.errorCode).toBe("AUTH_REVOKED");
    expect(await db.aiRiskFinding.count({ where: { runId: r.id } })).toBe(0);
    await db.projectMember.update({
      where: { projectId_userId: { projectId: p, userId: ids.manager } },
      data: { role: "MANAGER" },
    });
  });
  it("recovers expired leases as visible failures without automatic model retry", async () => {
    const id = randomUUID(),
      before = calls;
    await db.aiAnalysisRun.create({
      data: {
        id,
        projectId: p,
        requestedById: ids.manager,
        kind: "HEALTH",
        scope: {},
        requestKey: randomUUID(),
        requestHash: "expired-test",
        rulesVersion: RULES_VERSION,
        status: "RUNNING",
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(0),
      },
    });
    const r = await finish(id);
    expect(r.status).toBe("FAILED");
    expect(r.errorCode).toBe("WORKER_INTERRUPTED");
    expect(calls).toBe(before);
    const retry = await api(
      "post",
      runs() + "/" + id + "/retry",
      "manager",
      {},
    ).expect(201);
    expect((await finish(retry.body.id)).status).toBe("PARTIAL");
  });
  it("marks archived source evidence stale without crashing or leaking it to members", async () => {
    const r = await analyze("HEALTH");
    const t = await db.task.findUniqueOrThrow({ where: { id: ownTask } });
    await api("post", `/projects/${p}/tasks/${ownTask}/archive`, "manager", {
      revision: t.revision,
    }).expect(201);
    const manager = await api("get", runs() + "/" + r.id).expect(200);
    expect(manager.body.stale).toBe(true);
    expect(
      manager.body.findings.some(
        (f: any) =>
          f.evidence.some((e: any) => e.key === `task:${ownTask}`) &&
          !f.evidenceCurrent,
      ),
    ).toBe(true);
    const member = await api("get", runs() + "/" + r.id, "dev").expect(200);
    expect(
      member.body.findings.some((f: any) =>
        f.evidence.some((e: any) => e.key === `task:${ownTask}`),
      ),
    ).toBe(false);
  });
  it("cancels queued work and preserves completed history and queued jobs across backend restart", async () => {
    Object.assign(config, { enabled: false });
    const insert = () =>
      db.aiAnalysisRun.create({
        data: {
          projectId: p,
          requestedById: ids.manager,
          kind: "HEALTH",
          scope: {},
          requestKey: randomUUID(),
          requestHash: randomUUID(),
          rulesVersion: RULES_VERSION,
        },
      });
    const cancelled = await insert();
    await api("post", runs() + "/" + cancelled.id + "/cancel").expect(201);
    expect(
      (
        await db.aiAnalysisRun.findUniqueOrThrow({
          where: { id: cancelled.id },
        })
      ).status,
    ).toBe("CANCELLED");
    const pending = await insert();
    await app.close();
    await boot();
    expect((await finish(pending.id)).status).toBe("PARTIAL");
    const old = await api("get", runs() + "/" + reportId).expect(200);
    expect(old.body.findings.length).toBeGreaterThan(0);
    const h = await api("get", runs() + "?limit=2").expect(200);
    expect(h.body.items).toHaveLength(2);
    expect(h.body.nextCursor).toBeTruthy();
    expect(h.body.items[0]).not.toHaveProperty("findings");
    const next = await api(
      "get",
      runs() + "?limit=2&cursor=" + h.body.nextCursor,
    ).expect(200);
    expect(
      next.body.items.every(
        (x: any) => !h.body.items.some((y: any) => x.id === y.id),
      ),
    ).toBe(true);
  });
});
