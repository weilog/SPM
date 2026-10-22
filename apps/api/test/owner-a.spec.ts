import "reflect-metadata";
import "../src/environment";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { DbService } from "../src/db/db.module";
import { hashPassword } from "../src/auth/password";

describe("Owner A actual plans, documents and AB integration", () => {
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
  const schema = "spm_owner_a_" + randomBytes(8).toString("hex"),
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
  it("starts with empty actual data and rejects outsider/global-admin bypass and member writes", async () => {
    expect((await call("get", plans()).expect(200)).body).toEqual({
      available: true,
      stages: [],
      items: [],
    });
    for (const who of ["outsider", "admin"]) {
      await call("get", plans(), who).expect(404);
      await call("get", docs(), who).expect(404);
    }
    for (const who of ["developer", "tester"]) {
      await call("post", plans() + "/stages", who, {
        title: "No",
        start: "2026-10-01",
        end: "2026-10-31",
      }).expect(403);
      await call("post", docs() + "/folders", who, { name: "No" }).expect(403);
    }
  });
  it("creates/edits actual stages and goals; rejects invalid dates, stale revisions and foreign owners", async () => {
    await call("post", plans() + "/stages", "manager", {
      title: "Invalid",
      start: "2026-10-31",
      end: "2026-10-01",
    }).expect(400);
    await call("post", plans() + "/stages", "manager", {
      title: "Invalid",
      start: "2026-02-30",
      end: "2026-03-01",
    }).expect(400);
    await call("post", plans() + "/stages", "manager", {
      title: "Invalid",
      start: "2026-10-01",
      end: "2026-10-31",
      ownerUserId: foreign,
    }).expect(400);
    stage = (
      await call("post", plans() + "/stages", "manager", {
        title: "Design",
        description: "Real stage",
        start: "2026-10-01",
        end: "2026-10-31",
        ownerUserId: manager,
      }).expect(201)
    ).body.id;
    await call("patch", plans() + "/stages/" + stage, "manager", {
      title: "Design updated",
      revision: 0,
    }).expect(200);
    await call("patch", plans() + "/stages/" + stage, "manager", {
      title: "Stale",
      revision: 0,
    }).expect(409);
    const goal = (
      await call("post", plans() + `/stages/${stage}/goals`, "manager", {
        title: "Confirm scope",
      }).expect(201)
    ).body;
    await call(
      "patch",
      plans() + `/stages/${stage}/goals/${goal.id}`,
      "manager",
      { done: true },
    ).expect(200);
    const snapshot = (await call("get", plans(), "tester").expect(200)).body;
    expect(snapshot.stages[0].goals[0].done).toBe(true);
    expect(await db.productGoal.count({ where: { projectId: p } })).toBe(0);
  });
  it("uses existing Task IDs with bidirectional plan relations and keeps four-state plan workflow independent", async () => {
    task = (
      await call("post", root() + "/tasks", "manager", {
        title: "Shared task",
        description: "B task",
        assigneeUserId: developer,
      }).expect(201)
    ).body.id;
    item = (
      await call("post", plans() + "/items", "manager", {
        stageId: stage,
        title: "Plan work",
        start: "2026-10-05",
        end: "2026-10-10",
        ownerUserId: developer,
        taskIds: [task],
      }).expect(201)
    ).body.id;
    expect(
      (await call("get", root() + `/tasks/${task}`).expect(200)).body.planIds,
    ).toContain(item);
    expect(
      await db.taskHistory.count({
        where: { taskId: task, action: "关联计划项" },
      }),
    ).toBe(1);
    const snap = (await call("get", plans(), "developer").expect(200)).body;
    expect(snap.items[0].tasks[0].id).toBe(task);
    await call("patch", plans() + "/items/" + item, "manager", {
      status: "DONE",
      revision: 0,
    }).expect(400);
    await call("patch", plans() + "/items/" + item, "manager", {
      status: "IN_PROGRESS",
      revision: 0,
    }).expect(200);
    await call("patch", plans() + "/items/" + item, "manager", {
      status: "DONE",
      revision: 1,
    }).expect(200);
    await call("patch", plans() + "/items/" + item, "manager", {
      status: "TODO",
      revision: 2,
    }).expect(400);
    await call("patch", plans() + "/items/" + item, "manager", {
      status: "IN_PROGRESS",
      revision: 2,
    }).expect(200);
    await call("patch", plans() + "/items/" + item, "manager", {
      status: "PAUSED",
      revision: 3,
    }).expect(200);
    await call("patch", plans() + "/items/" + item, "manager", {
      status: "TODO",
      revision: 4,
    }).expect(200);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task } })).status,
    ).toBe("TODO");
    const focus = (
      await call(
        "get",
        root() + `/relations/resolve?entityType=planItem&entityId=${item}`,
      ).expect(200)
    ).body;
    expect(focus.tasks).toContain(task);
    expect(focus.planItems).toContain(item);
  });
  it("persists gantt dates and milestones and enforces project isolation for stage/task relations", async () => {
    await call("patch", plans() + "/items/" + item, "manager", {
      start: "2026-10-06",
      end: "2026-10-12",
      revision: 5,
    }).expect(200);
    await call("patch", plans() + "/items/" + item, "manager", {
      start: "2026-10-07",
      revision: 5,
    }).expect(409);
    const milestone = (
      await call("post", plans() + "/items", "manager", {
        stageId: stage,
        kind: "milestone",
        title: "Review",
        start: "2026-10-31",
      }).expect(201)
    ).body;
    expect(milestone.end).toBe("2026-10-31");
    await call("patch", plans() + "/items/" + milestone.id, "manager", {
      taskIds: [task],
    }).expect(400);
    await call("patch", plans() + "/items/" + item, "manager", {
      stageId: "foreign",
    }).expect(400);
    const foreignTask = await db.task.create({
      data: { projectId: other, title: "Secret" },
    });
    await call("patch", plans() + "/items/" + item, "manager", {
      taskIds: [foreignTask.id],
    }).expect(400);
    await call("post", root() + "/tasks", "manager", {
      title: "Foreign plan",
      planIds: ["fake"],
    }).expect(400);
    const developerSnap = (await call("get", plans(), "tester").expect(200))
      .body;
    expect(
      developerSnap.items.find((x: { id: string }) => x.id === item).tasks,
    ).toEqual([]);
    const saved = await db.planItem.findUniqueOrThrow({ where: { id: item } });
    expect(saved.start).toBe("2026-10-06");
  });
  it("preserves archived task relations for managers but excludes them from member-only tracking", async () => {
    const t = (
      await call("post", root() + "/tasks", "manager", {
        title: "Archived linked task",
        assigneeUserId: developer,
      }).expect(201)
    ).body;
    const i = (
      await call("post", plans() + "/items", "manager", {
        stageId: stage,
        title: "Archive tracking",
        start: "2026-10-10",
        end: "2026-10-12",
        taskIds: [t.id],
      }).expect(201)
    ).body;
    await call("post", root() + `/tasks/${t.id}/archive`, "manager", {
      revision: 1,
    }).expect(201);
    const own = (
      await call("get", plans(), "developer").expect(200)
    ).body.items.find((x: { id: string }) => x.id === i.id);
    expect(own.tasks).toEqual([]);
    expect(own.taskIds).toEqual([]);
    const managed = (await call("get", plans()).expect(200)).body.items.find(
      (x: { id: string }) => x.id === i.id,
    );
    expect(managed.tasks[0].archivedAt).toBeTruthy();
  });
  it("stores real upload bytes and serves identical authorized download/text preview, not metadata-only mock files", async () => {
    const folder = (
      await call("post", docs() + "/folders", "manager", {
        name: "项目资料",
      }).expect(201)
    ).body;
    const upload = await request(app.getHttpServer())
      .post("/api" + docs() + `/upload?parentId=${folder.id}`)
      .set("Cookie", cookies.manager)
      .set("X-SPM-Request", "1")
      .set("Origin", "http://127.0.0.1:5173")
      .attach("file", Buffer.from("# 实际文件\n文件内容持久化。\n"), {
        filename: "说明.md",
        contentType: "text/plain",
      })
      .expect(201);
    expect(upload.body.name).toBe("说明.md");
    expect(upload.body.content).toBeUndefined();
    const response = await call(
      "get",
      docs() + `/${upload.body.id}/content?download=1`,
      "developer",
    ).expect(200);
    expect(response.text).toBe("# 实际文件\n文件内容持久化。\n");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      Buffer.from(
        (
          await db.projectDocument.findUniqueOrThrow({
            where: { id: upload.body.id },
          })
        ).content!,
      ).toString(),
    ).toBe(response.text);
    await call("get", docs() + `/${upload.body.id}/content`, "outsider").expect(
      404,
    );
    await call("patch", docs() + `/${upload.body.id}`, "developer", {
      name: "No.md",
    }).expect(403);
    await request(app.getHttpServer())
      .post("/api" + docs() + "/upload")
      .set("Cookie", cookies.manager)
      .set("X-SPM-Request", "1")
      .set("Origin", "http://127.0.0.1:5173")
      .attach("file", Buffer.from("<html>"), { filename: "blocked.html" })
      .expect(400);
  });
  it("manages folder trees, rename/move, duplicate conflicts, no cycles/cross-project association and atomic batches", async () => {
    const a = (
      await call("post", docs() + "/folders", "manager", {
        name: "Parent",
      }).expect(201)
    ).body;
    const b = (
      await call("post", docs() + "/folders", "manager", {
        name: "Child",
        parentId: a.id,
      }).expect(201)
    ).body;
    await call("post", docs() + "/folders", "manager", {
      name: "parent",
    }).expect(409);
    await call("patch", docs() + `/${a.id}`, "manager", {
      parentId: b.id,
    }).expect(400);
    await call("patch", docs() + `/${b.id}`, "manager", {
      name: "Renamed",
      revision: 0,
    }).expect(200);
    await call("patch", docs() + `/${b.id}`, "manager", {
      name: "Stale",
      revision: 0,
    }).expect(409);
    const foreignFolder = await db.projectDocument.create({
      data: {
        projectId: other,
        kind: "FOLDER",
        name: "Foreign",
        ownerUserId: foreign,
        ownerName: "foreign",
      },
    });
    await call("patch", docs() + `/${b.id}`, "manager", {
      parentId: foreignFolder.id,
    }).expect(400);
    await call("post", docs() + "/batch", "manager", {
      ids: [a.id, foreignFolder.id],
      action: "delete",
    }).expect(404);
    expect(await db.projectDocument.count({ where: { id: a.id } })).toBe(1);
    await call("post", docs() + "/batch", "manager", {
      ids: [b.id],
      action: "move",
      parentId: null,
    }).expect(201);
    expect(
      (await db.projectDocument.findUniqueOrThrow({ where: { id: b.id } }))
        .parentId,
    ).toBeNull();
    await call("patch", docs() + `/${b.id}`, "manager", {
      parentId: a.id,
    }).expect(200);
    await call("delete", docs() + `/${a.id}`).expect(200);
    expect(
      await db.projectDocument.count({ where: { id: { in: [a.id, b.id] } } }),
    ).toBe(0);
  });
  it("shares the canonical member/Task data; reassignment and removal update plan tracking without copying tasks", async () => {
    await call("patch", root() + `/tasks/${task}/assignee`, "manager", {
      assigneeUserId: tester,
    }).expect(200);
    let snap = (await call("get", plans()).expect(200)).body;
    expect(
      snap.items.find((i: { id: string }) => i.id === item).tasks[0]
        .assigneeUserId,
    ).toBe(tester);
    await call("delete", root() + `/members/${developer}`).expect(200);
    snap = (await call("get", plans()).expect(200)).body;
    expect(
      snap.items.find((i: { id: string }) => i.id === item).ownerUserId,
    ).toBeNull();
    await call("get", plans(), "developer").expect(404);
    await call("get", docs(), "developer").expect(404);
    await call("delete", root() + `/members/${manager}`).expect(400);
    expect(await db.task.count({ where: { id: task } })).toBe(1);
  });
});
