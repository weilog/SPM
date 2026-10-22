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
import type { Role } from "@spm/shared";

describe("Sprint 1 PostgreSQL REST integration", () => {
  let app: INestApplication, db: DbService, pool: Pool;
  let admin: number,
    manager: number,
    managerB: number,
    member: number,
    outsider: number,
    tester: number;
  let project: number, otherProject: number;
  const password = randomBytes(24).toString("hex");
  const schema = "spm_test_" + randomBytes(8).toString("hex");
  const cookies: Record<string, string> = {};
  const originalUrl = process.env.DATABASE_URL!;
  function call(
    method: "get" | "post" | "patch" | "delete",
    path: string,
    who?: string,
    data?: object,
  ) {
    let test = request(app.getHttpServer())
      [method]("/api" + path)
      .set("X-SPM-Request", "1")
      .set("Origin", "http://127.0.0.1:5173");
    if (who) test = test.set("Cookie", cookies[who]);
    if (data !== undefined) test = test.send(data);
    return test;
  }
  async function login(name: string) {
    const result = await call("post", "/auth/login", undefined, {
      username: name,
      password,
    }).expect(201);
    const cookie = result.headers["set-cookie"][0] as string;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    cookies[name] = cookie.split(";")[0];
    return result;
  }
  beforeAll(async () => {
    if (
      !originalUrl ||
      !["localhost", "127.0.0.1"].includes(new URL(originalUrl).hostname)
    )
      throw new Error("Tests require local PostgreSQL");
    pool = new Pool({ connectionString: originalUrl });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(originalUrl);
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
      { cwd: resolve("."), env: process.env, stdio: "pipe" },
    );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configure(module.createNestApplication());
    await app.init();
    db = app.get(DbService);
    const hash = await hashPassword(password);
    for (const [name, role] of [
      ["admin", "ADMIN"],
      ["manager", "MANAGER"],
      ["manager_b", "MANAGER"],
      ["member", "MEMBER"],
      ["outsider", "MEMBER"],
      ["tester", "MEMBER"],
    ] as [string, Role][]) {
      await db.user.create({
        data: { username: name, role, passwordHash: hash },
      });
      await login(name);
    }
    const users = await db.user.findMany();
    admin = users.find((user) => user.username === "admin")!.id;
    manager = users.find((user) => user.username === "manager")!.id;
    managerB = users.find((user) => user.username === "manager_b")!.id;
    member = users.find((user) => user.username === "member")!.id;
    outsider = users.find((user) => user.username === "outsider")!.id;
    tester = users.find((user) => user.username === "tester")!.id;
    project = (
      await call("post", "/projects", "manager", {
        name: "Alpha",
        description: "Alpha-only-data",
      }).expect(201)
    ).body.id;
    otherProject = (
      await call("post", "/projects", "manager_b", { name: "Beta" }).expect(201)
    ).body.id;
    await call("post", `/projects/${project}/members`, "manager", {
      userId: member,
    }).expect(201);
    await call("post", `/projects/${project}/members`, "manager", {
      userId: tester,
      role: "TESTER",
    }).expect(201);
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
    process.env.DATABASE_URL = originalUrl;
  });

  it("US01 rejects wrong password and unknown/inactive users", async () => {
    for (const username of ["admin", "missing"])
      await call("post", "/auth/login", undefined, {
        username,
        password: "wrong",
      }).expect(401);
    const user = await db.user.create({
      data: {
        username: "inactive",
        passwordHash: await hashPassword(password),
        active: false,
      },
    });
    await call("post", "/auth/login", undefined, {
      username: user.username,
      password,
    }).expect(401);
  });
  it("US01 rejects unauthenticated requests with a consistent error", async () => {
    for (const path of [
      "/auth/me",
      "/users",
      "/projects",
      `/projects/${project}/tasks`,
    ]) {
      const result = await call("get", path).expect(401);
      expect(result.body).toMatchObject({
        statusCode: 401,
        code: "UNAUTHENTICATED",
      });
    }
  });
  it("US01 returns current user without password or session secrets", async () => {
    const result = await call("get", "/auth/me", "member").expect(200);
    expect(result.body).toEqual({
      id: member,
      username: "member",
      role: "MEMBER",
      active: true,
    });
  });
  it("US01 logout revokes a copied token on the server", async () => {
    await login("outsider");
    const oldCookie = cookies.outsider;
    await call("post", "/auth/logout", "outsider", {}).expect(201);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", oldCookie)
      .expect(401);
    await login("outsider");
  });
  it("rejects cross-origin writes and missing custom headers", async () => {
    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", cookies.manager)
      .send({ name: "CSRF" })
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", cookies.manager)
      .set("X-SPM-Request", "1")
      .set("Origin", "https://attacker.example")
      .send({ name: "CSRF" })
      .expect(403);
  });
  it("US02 permits admin account CRUD but excludes US16 global grants", async () => {
    const created = (
      await call("post", "/users", "admin", {
        username: "created",
        password,
      }).expect(201)
    ).body;
    expect(created).not.toHaveProperty("passwordHash");
    await call("patch", `/users/${created.id}`, "admin", {
      username: "renamed",
    }).expect(200);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: created.id } })).role,
    ).toBe("MEMBER");
    await call("patch", `/users/${created.id}`, "admin", {
      role: "MANAGER",
    }).expect(400);
    await call("post", "/users", "admin", {
      username: "global-grant",
      password,
      role: "ADMIN",
    }).expect(400);
    for (const who of ["member", "manager", "manager_b", "tester"]) {
      await call("get", "/users", who).expect(403);
      await call("patch", `/users/${created.id}`, who, {
        role: "ADMIN",
      }).expect(403);
      await call("delete", `/users/${created.id}`, who).expect(403);
      await call("post", "/users", who, {
        username: "forged",
        password,
        role: "ADMIN",
      }).expect(403);
    }
    await call("delete", `/users/${created.id}`, "admin").expect(200);
    expect(await db.user.findUnique({ where: { id: created.id } })).toBeNull();
  });
  it("US02 validates passwords/usernames/roles and duplicate usernames", async () => {
    for (const data of [
      { username: "weak", password: "123" },
      { username: "invalid space", password },
      { username: "role", password, role: "OWNER" },
    ])
      await call("post", "/users", "admin", data).expect(400);
    await call("post", "/users", "admin", {
      username: "member",
      password,
    }).expect(409);
  });
  it("US02 preserves the last administrator and protects assigned managers from deletion", async () => {
    await call("patch", `/users/${admin}`, "admin", { active: false }).expect(
      400,
    );
    await call("patch", `/users/${admin}`, "admin", { role: "MEMBER" }).expect(
      400,
    );
    await call("delete", `/users/${admin}`, "admin").expect(400);
    await call("delete", `/users/${manager}`, "admin").expect(400);
  });
  it("US03 binds managers automatically and rejects forged manager identities", async () => {
    const created = (
      await call("post", "/projects", "manager", {
        name: "  Trimmed  ",
      }).expect(201)
    ).body;
    expect(created.managerId).toBe(manager);
    expect(created.name).toBe("Trimmed");
    expect(
      await db.projectMember.count({
        where: { projectId: created.id, userId: manager },
      }),
    ).toBe(1);
    await call("post", "/projects", "manager", {
      name: "Forged",
      managerId: managerB,
    }).expect(400);
    await call("post", "/projects", "member", { name: "Denied" }).expect(403);
  });
  it("US03 requires admins to select an active manager and validates required name", async () => {
    await call("post", "/projects", "admin", {
      name: "Admin project",
      managerId: managerB,
    }).expect(201);
    for (const managerId of [undefined, -1, 999999])
      await call("post", "/projects", "admin", {
        name: "Rejected",
        managerId,
      }).expect(400);
    for (const name of ["", " ", "x".repeat(201)])
      await call("post", "/projects", "manager", { name }).expect(400);
    await call("post", "/projects", "manager", {
      name: "Extra",
      projectId: otherProject,
    }).expect(400);
  });
  it("US04 adds/removes members, rejects duplicates and protects the manager", async () => {
    await call("post", `/projects/${project}/members`, "manager", {
      userId: outsider,
    }).expect(201);
    await call("post", `/projects/${project}/members`, "manager", {
      userId: outsider,
    }).expect(409);
    await call(
      "delete",
      `/projects/${project}/members/${manager}`,
      "manager",
    ).expect(400);
    await call(
      "delete",
      `/projects/${project}/members/${outsider}`,
      "manager",
    ).expect(200);
    await call("post", `/projects/${project}/members`, "manager", {
      userId: -1,
    }).expect(400);
  });
  it("US04 does not grant management to a member with global manager identity", async () => {
    await call("post", `/projects/${project}/members`, "manager", {
      userId: managerB,
    }).expect(201);
    await call("get", `/projects/${project}`, "manager_b").expect(200);
    await call("post", `/projects/${project}/members`, "manager_b", {
      userId: outsider,
    }).expect(403);
    await call(
      "delete",
      `/projects/${project}/members/${member}`,
      "manager_b",
    ).expect(403);
    await call(
      "delete",
      `/projects/${otherProject}/members/${member}`,
      "manager",
    ).expect(404);
    await call(
      "delete",
      `/projects/${project}/members/${managerB}`,
      "manager",
    ).expect(200);
  });
  it("US06 scopes the list and direct project lookups", async () => {
    const list = (await call("get", "/projects", "member").expect(200)).body;
    expect(list.map((item: { id: number }) => item.id)).toEqual([project]);
    await call("get", `/projects/${otherProject}`, "member").expect(404);
    await call("get", `/projects/${project}`, "outsider").expect(404);
    expect((await call("get", "/projects", "admin").expect(200)).body).toEqual(
      [],
    );
    await call("get", `/projects/${project}`, "admin").expect(404);
  });
  it("US06 supports membership in multiple projects and revokes access on removal", async () => {
    await call("post", `/projects/${otherProject}/members`, "manager_b", {
      userId: member,
    }).expect(201);
    for (const id of [project, otherProject])
      expect(
        (await call("get", `/projects/${id}`, "member").expect(200)).body.id,
      ).toBe(id);
    await call(
      "delete",
      `/projects/${otherProject}/members/${member}`,
      "manager_b",
    ).expect(200);
    await call("get", `/projects/${otherProject}`, "member").expect(404);
  });
  it("US07 creates persistent TODO tasks but rejects blank title or forged status/project", async () => {
    const task = (
      await call("post", `/projects/${project}/tasks`, "manager", {
        title: "  Work  ",
        description: "Detail",
      }).expect(201)
    ).body;
    expect(task).toMatchObject({
      projectId: project,
      title: "Work",
      status: "TODO",
      assigneeUserId: null,
    });
    for (const data of [
      { title: "" },
      { title: " " },
      { title: "x".repeat(201) },
      { title: "status", status: "DONE" },
      { title: "project", projectId: otherProject },
    ])
      await call("post", `/projects/${project}/tasks`, "manager", data).expect(
        400,
      );
    await call("post", `/projects/${project}/tasks`, "member", {
      title: "Denied",
    }).expect(403);
    await call("post", `/projects/${otherProject}/tasks`, "manager", {
      title: "Denied",
    }).expect(404);
  });
  it("US09 assigns/reassigns/clears only effective members and hides cross-project tasks", async () => {
    const task = (
      await call("post", `/projects/${project}/tasks`, "manager", {
        title: "Assign",
        assigneeUserId: member,
      }).expect(201)
    ).body;
    const path = `/projects/${project}/tasks/${task.id}/assignee`;
    for (const assigneeUserId of [manager, member, null])
      expect(
        (await call("patch", path, "manager", { assigneeUserId }).expect(200))
          .body.assigneeUserId,
      ).toBe(assigneeUserId);
    await call("patch", path, "manager", { assigneeUserId: outsider }).expect(
      400,
    );
    await call("patch", path, "member", { assigneeUserId: member }).expect(403);
    await call(
      "patch",
      `/projects/${otherProject}/tasks/${task.id}/assignee`,
      "manager_b",
      { assigneeUserId: managerB },
    ).expect(404);
    await call("patch", path, "manager", {}).expect(400);
    await call("patch", path, "manager", {
      assigneeUserId: member,
      title: "Forged",
    }).expect(400);
  });
  it("US09 rejects inactive member assignments and database bypasses", async () => {
    const inactive = await db.user.findUniqueOrThrow({
      where: { username: "inactive" },
    });
    await call("post", `/projects/${project}/members`, "manager", {
      userId: inactive.id,
    }).expect(400);
    // Trusted fixture bypass to test the database active-user trigger itself.
    await db.projectMember.create({
      data: { projectId: project, userId: inactive.id },
    });
    await call("post", `/projects/${project}/tasks`, "manager", {
      title: "Rejected",
      assigneeUserId: inactive.id,
    }).expect(400);
    await expect(
      db.task.create({
        data: {
          projectId: project,
          title: "DB inactive",
          assigneeUserId: inactive.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.task.create({
        data: {
          projectId: project,
          title: "DB other",
          assigneeUserId: managerB,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.task.create({
        data: { projectId: project, title: "DB status", status: "DONE" },
      }),
    ).rejects.toThrow();
  });
  it("US09 removes assignments only within the removed membership project", async () => {
    await call("post", `/projects/${otherProject}/members`, "manager_b", {
      userId: member,
    }).expect(201);
    const first = await db.task.create({
      data: { projectId: project, title: "First", assigneeUserId: member },
    });
    const second = await db.task.create({
      data: {
        projectId: otherProject,
        title: "Second",
        assigneeUserId: member,
      },
    });
    await call(
      "delete",
      `/projects/${otherProject}/members/${member}`,
      "manager_b",
    ).expect(200);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: first.id } }))
        .assigneeUserId,
    ).toBe(member);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: second.id } }))
        .assigneeUserId,
    ).toBeNull();
  });
  it("US02/09 deactivation revokes sessions and clears assignments atomically", async () => {
    await call("patch", `/users/${member}`, "admin", { active: false }).expect(
      200,
    );
    await call("get", "/auth/me", "member").expect(401);
    expect(await db.task.count({ where: { assigneeUserId: member } })).toBe(0);
    await call("patch", `/users/${member}`, "admin", { active: true }).expect(
      200,
    );
    await login("member");
  });
  it("US05 project manager revocation takes effect on existing sessions", async () => {
    await call("post", `/projects/${project}/members`, "manager", {
      userId: managerB,
      role: "MANAGER",
    }).expect(201);
    await call(
      "patch",
      `/projects/${project}/members/${manager}/role`,
      "manager_b",
      { role: "DEVELOPER" },
    ).expect(200);
    await call("get", `/projects/${project}`, "manager").expect(200);
    await call("post", "/projects", "manager", {
      name: "Creation identity retained",
    }).expect(201);
    await call("post", `/projects/${project}/tasks`, "manager", {
      title: "Denied",
    }).expect(403);
    await call("post", `/projects/${project}/members`, "manager", {
      userId: outsider,
    }).expect(403);
    await call(
      "patch",
      `/projects/${project}/members/${manager}/role`,
      "manager_b",
      { role: "MANAGER" },
    ).expect(200);
    await call(
      "delete",
      `/projects/${project}/members/${managerB}`,
      "manager",
    ).expect(200);
  });
  it("US02 password changes invalidate old sessions and passwords", async () => {
    await call("patch", `/users/${outsider}`, "admin", {
      password: password + "new",
    }).expect(200);
    await call("get", "/auth/me", "outsider").expect(401);
    await call("post", "/auth/login", undefined, {
      username: "outsider",
      password,
    }).expect(401);
    await call("post", "/auth/login", undefined, {
      username: "outsider",
      password: password + "new",
    }).expect(201);
  });
  it("rejects explicit null for non-nullable optional DTO fields", async () => {
    for (const field of ["username", "password", "role", "active"])
      await call("patch", `/users/${member}`, "admin", {
        [field]: null,
      }).expect(400);
    await call("post", "/projects", "manager", {
      name: "Null description",
      description: null,
    }).expect(400);
    await call("post", `/projects/${project}/tasks`, "manager", {
      title: "Null description",
      description: null,
    }).expect(400);
  });
  it("concurrent duplicate membership creation preserves uniqueness", async () => {
    const results = await Promise.all([
      call("post", `/projects/${project}/members`, "manager", {
        userId: outsider,
      }),
      call("post", `/projects/${project}/members`, "manager", {
        userId: outsider,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      await db.projectMember.count({
        where: { projectId: project, userId: outsider },
      }),
    ).toBe(1);
    await call(
      "delete",
      `/projects/${project}/members/${outsider}`,
      "manager",
    ).expect(200);
  });
  it("assignment racing with deactivation never leaves an inactive assignee", async () => {
    const task = await db.task.create({
      data: { projectId: project, title: "Race" },
    });
    const results = await Promise.all([
      call(
        "patch",
        `/projects/${project}/tasks/${task.id}/assignee`,
        "manager",
        { assigneeUserId: member },
      ),
      call("patch", `/users/${member}`, "admin", { active: false }),
    ]);
    expect(results[1].status).toBe(200);
    expect([200, 400, 409]).toContain(results[0].status);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } }))
        .assigneeUserId,
    ).toBeNull();
    await call("patch", `/users/${member}`, "admin", { active: true }).expect(
      200,
    );
    await login("member");
  });
  it("US05 only project managers can change preset project roles", async () => {
    const path = `/projects/${project}/members/${member}/role`;
    await call("patch", path, "member", { role: "MANAGER" }).expect(403);
    await call("patch", path, "tester", { role: "MANAGER" }).expect(403);
    await call("patch", path, "manager_b", { role: "TESTER" }).expect(404);
    await call("patch", path, "admin", { role: "TESTER" }).expect(404);
    await call("patch", path, "manager", { role: "CUSTOM" }).expect(400);
    await call("patch", path, "manager", { role: "TESTER" }).expect(200);
    expect(
      (await call("get", `/projects/${project}`, "member").expect(200)).body
        .projectRole,
    ).toBe("TESTER");
    await call("patch", path, "manager", { role: "DEVELOPER" }).expect(200);
  });
  it("US05 role changes are project scoped and preserve a valid manager", async () => {
    await call(
      "patch",
      `/projects/${project}/members/${manager}/role`,
      "manager",
      { role: "DEVELOPER" },
    ).expect(400);
    await call(
      "patch",
      `/projects/${project}/members/${managerB}/role`,
      "manager",
      { role: "MANAGER" },
    ).expect(404);
    await call(
      "patch",
      `/projects/${otherProject}/members/${managerB}/role`,
      "manager",
      { role: "DEVELOPER" },
    ).expect(404);
    expect(
      (
        await db.projectMember.findUniqueOrThrow({
          where: { projectId_userId: { projectId: project, userId: manager } },
        })
      ).role,
    ).toBe("MANAGER");
  });
  it("US05 a promoted project manager gains management without a global role change", async () => {
    await call(
      "patch",
      `/projects/${project}/members/${member}/role`,
      "manager",
      { role: "MANAGER" },
    ).expect(200);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: member } })).role,
    ).toBe("MEMBER");
    await call("post", `/projects/${project}/tasks`, "member", {
      title: "Project manager task",
    }).expect(201);
    expect(
      (await call("get", "/projects/creation-options", "member").expect(200))
        .body.canCreate,
    ).toBe(true);
    await call(
      "patch",
      `/projects/${project}/members/${member}/role`,
      "manager",
      { role: "DEVELOPER" },
    ).expect(200);
    await call("post", `/projects/${project}/tasks`, "member", {
      title: "Revoked project role",
    }).expect(403);
  });
  it("US03 administrator creation grants only the designated project manager membership", async () => {
    const account = (
      await call("post", "/users", "admin", {
        username: "new-project-owner",
        password,
      }).expect(201)
    ).body;
    const created = (
      await call("post", "/projects", "admin", {
        name: "New owner project",
        managerId: account.id,
      }).expect(201)
    ).body;
    expect(
      await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: created.id, userId: admin } },
      }),
    ).toBeNull();
    expect(
      (
        await db.projectMember.findUniqueOrThrow({
          where: {
            projectId_userId: { projectId: created.id, userId: account.id },
          },
        })
      ).role,
    ).toBe("MANAGER");
    await call("get", `/projects/${created.id}`, "admin").expect(404);
  });
  it("US10 developers and testers see only their own assigned tasks and details", async () => {
    const first = (
      await call("post", `/projects/${project}/tasks`, "manager", {
        title: "Developer private",
        assigneeUserId: member,
      }).expect(201)
    ).body;
    const second = (
      await call("post", `/projects/${project}/tasks`, "manager", {
        title: "Tester private",
        assigneeUserId: tester,
      }).expect(201)
    ).body;
    for (const [who, id, otherId, userId] of [
      ["member", first.id, second.id, member],
      ["tester", second.id, first.id, tester],
    ] as const) {
      const list = (
        await call(
          "get",
          `/projects/${project}/tasks/mine?userId=${tester}`,
          who,
        ).expect(200)
      ).body;
      expect(list.length).toBeGreaterThan(0);
      expect(
        list.every(
          (task: { assigneeUserId: number }) => task.assigneeUserId === userId,
        ),
      ).toBe(true);
      expect(
        (
          await call(
            "get",
            `/projects/${project}/tasks/mine/${id}`,
            who,
          ).expect(200)
        ).body.id,
      ).toBe(id);
      await call(
        "get",
        `/projects/${project}/tasks/mine/${otherId}`,
        who,
      ).expect(404);
      await call("get", `/projects/${otherProject}/tasks/mine`, who).expect(
        404,
      );
      await call("get", `/projects/${project}/tasks`, who).expect(403);
    }
    await call("get", `/projects/${project}/tasks/mine`, "manager").expect(403);
    await call("get", `/projects/${project}/tasks/mine`, "admin").expect(404);
  });
  it("US10 role revocation and reassignment immediately revoke personal task access", async () => {
    const task = (
      await call("post", `/projects/${project}/tasks`, "manager", {
        title: "Own detail",
        assigneeUserId: tester,
      }).expect(201)
    ).body;
    await call(
      "get",
      `/projects/${project}/tasks/mine/${task.id}`,
      "tester",
    ).expect(200);
    await call(
      "patch",
      `/projects/${project}/tasks/${task.id}/assignee`,
      "manager",
      { assigneeUserId: member },
    ).expect(200);
    await call(
      "get",
      `/projects/${project}/tasks/mine/${task.id}`,
      "tester",
    ).expect(404);
    await call(
      "patch",
      `/projects/${project}/members/${member}/role`,
      "manager",
      { role: "MANAGER" },
    ).expect(200);
    await call("get", `/projects/${project}/tasks/mine`, "member").expect(403);
    await call(
      "patch",
      `/projects/${project}/members/${member}/role`,
      "manager",
      { role: "DEVELOPER" },
    ).expect(200);
  });
  it("US20/21 manager creates formal requirements and authorized roles view list/detail", async () => {
    const created = (
      await call("post", `/projects/${project}/requirements`, "manager", {
        title: "  正式需求  ",
        description: "业务目标",
      }).expect(201)
    ).body;
    expect(created).toMatchObject({
      title: "正式需求",
      projectId: project,
      description: "业务目标",
    });
    for (const who of ["manager", "member", "tester"]) {
      const list = (
        await call("get", `/projects/${project}/requirements`, who).expect(200)
      ).body;
      expect(
        list.some(
          (requirement: { id: number }) => requirement.id === created.id,
        ),
      ).toBe(true);
      expect(
        (
          await call(
            "get",
            `/projects/${project}/requirements/${created.id}`,
            who,
          ).expect(200)
        ).body.description,
      ).toBe("业务目标");
    }
    await call("get", `/projects/${project}/requirements`, "admin").expect(404);
    await call(
      "get",
      `/projects/${project}/requirements/${created.id}`,
      "manager_b",
    ).expect(404);
  });
  it("US21 only project managers create/edit formal requirements, even for global admins", async () => {
    const requirement = (
      await call("post", `/projects/${project}/requirements`, "manager", {
        title: "Editable",
        description: "Before",
      }).expect(201)
    ).body;
    const path = `/projects/${project}/requirements/${requirement.id}`;
    expect(
      (
        await call("patch", path, "manager", {
          title: "  Updated  ",
          description: "After",
        }).expect(200)
      ).body,
    ).toMatchObject({ title: "Updated", description: "After" });
    for (const [who, code] of [
      ["member", 403],
      ["tester", 403],
      ["admin", 404],
      ["manager_b", 404],
    ] as const) {
      await call("post", `/projects/${project}/requirements`, who, {
        title: "Denied",
      }).expect(code);
      await call("patch", path, who, { title: "Denied" }).expect(code);
    }
    expect(
      (
        await db.requirement.findUniqueOrThrow({
          where: { id: requirement.id },
        })
      ).title,
    ).toBe("Updated");
  });
  it("US20/21 cross-project requirement IDs never permit reads or edits", async () => {
    const requirement = (
      await call("post", `/projects/${project}/requirements`, "manager", {
        title: "Alpha only",
      }).expect(201)
    ).body;
    await call(
      "get",
      `/projects/${otherProject}/requirements/${requirement.id}`,
      "manager_b",
    ).expect(404);
    await call(
      "patch",
      `/projects/${otherProject}/requirements/${requirement.id}`,
      "manager_b",
      { title: "Forged" },
    ).expect(404);
    const otherList = (
      await call(
        "get",
        `/projects/${otherProject}/requirements`,
        "manager_b",
      ).expect(200)
    ).body;
    expect(
      otherList.some((item: { id: number }) => item.id === requirement.id),
    ).toBe(false);
  });
  it("US21 validates required/oversized/null fields and excludes future associations", async () => {
    for (const data of [
      { title: "" },
      { title: " " },
      { title: "x".repeat(201) },
      { title: "Long", description: "x".repeat(10001) },
      { title: "Null", description: null },
      { title: "Project", projectId: otherProject },
      { title: "Tasks", taskIds: [1] },
      { title: "State", status: "IMPLEMENTED" },
    ]) {
      await call(
        "post",
        `/projects/${project}/requirements`,
        "manager",
        data,
      ).expect(400);
    }
    const requirement = (
      await call("post", `/projects/${project}/requirements`, "manager", {
        title: "Validate edits",
      }).expect(201)
    ).body;
    for (const data of [
      {},
      { title: "" },
      { title: null },
      { description: null },
      { projectId: otherProject },
      { taskIds: [1] },
    ])
      await call(
        "patch",
        `/projects/${project}/requirements/${requirement.id}`,
        "manager",
        data,
      ).expect(400);
    await call(
      "patch",
      `/projects/${project}/requirements/${requirement.id}`,
      "manager",
      { description: "" },
    ).expect(200);
  });
  it("project authorization applies to administrators exactly like other project members", async () => {
    await call("post", `/projects/${project}/members`, "manager", {
      userId: admin,
      role: "DEVELOPER",
    }).expect(201);
    await call("get", `/projects/${project}`, "admin").expect(200);
    await call("get", `/projects/${project}/requirements`, "admin").expect(200);
    await call("post", `/projects/${project}/tasks`, "admin", {
      title: "No global bypass",
    }).expect(403);
    await call("post", `/projects/${project}/requirements`, "admin", {
      title: "No global bypass",
    }).expect(403);
    await call(
      "patch",
      `/projects/${project}/members/${member}/role`,
      "admin",
      { role: "MANAGER" },
    ).expect(403);
    await call("get", "/users", "admin").expect(200);
    const task = (
      await call("post", `/projects/${project}/tasks`, "manager", {
        title: "Authorized admin own task",
        assigneeUserId: admin,
      }).expect(201)
    ).body;
    await call(
      "get",
      `/projects/${project}/tasks/mine/${task.id}`,
      "admin",
    ).expect(200);
    await call(
      "patch",
      `/projects/${project}/members/${admin}/role`,
      "manager",
      { role: "MANAGER" },
    ).expect(200);
    await call("post", `/projects/${project}/requirements`, "admin", {
      title: "Explicit project permission",
    }).expect(201);
    await call(
      "delete",
      `/projects/${project}/members/${admin}`,
      "manager",
    ).expect(200);
    await call("get", `/projects/${project}`, "admin").expect(404);
  });
  it("membership removal revokes US10/20 access and retains task/requirement records", async () => {
    const count = await db.requirement.count({ where: { projectId: project } });
    await call(
      "delete",
      `/projects/${project}/members/${tester}`,
      "manager",
    ).expect(200);
    await call("get", `/projects/${project}/requirements`, "tester").expect(
      404,
    );
    await call("get", `/projects/${project}/tasks/mine`, "tester").expect(404);
    expect(await db.requirement.count({ where: { projectId: project } })).toBe(
      count,
    );
    expect(await db.task.count({ where: { assigneeUserId: tester } })).toBe(0);
  });
  it("new project routes reject anonymous callers and forged write origins", async () => {
    for (const path of [
      `/projects/${project}/requirements`,
      `/projects/${project}/tasks/mine`,
    ])
      await call("get", path).expect(401);
    await request(app.getHttpServer())
      .post(`/api/projects/${project}/requirements`)
      .set("Cookie", cookies.manager)
      .send({ title: "CSRF" })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/projects/${project}/members/${member}/role`)
      .set("Cookie", cookies.manager)
      .send({ role: "MANAGER" })
      .expect(403);
  });
  it("US05 concurrent role demotions cannot remove every project manager", async () => {
    await call(
      "patch",
      `/projects/${project}/members/${member}/role`,
      "manager",
      { role: "MANAGER" },
    ).expect(200);
    const results = await Promise.all([
      call("patch", `/projects/${project}/members/${manager}/role`, "manager", {
        role: "DEVELOPER",
      }),
      call("patch", `/projects/${project}/members/${member}/role`, "member", {
        role: "DEVELOPER",
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    const remaining = await db.projectMember.findMany({
      where: { projectId: project, role: "MANAGER", user: { active: true } },
    });
    expect(remaining).toHaveLength(1);
    const who = remaining[0].userId === manager ? "manager" : "member";
    const revoked = remaining[0].userId === manager ? member : manager;
    await call("patch", `/projects/${project}/members/${revoked}/role`, who, {
      role: "MANAGER",
    }).expect(200);
    await call(
      "patch",
      `/projects/${project}/members/${member}/role`,
      "manager",
      { role: "DEVELOPER" },
    ).expect(200);
  });

  describe("Sprint 2 phase 1 stories", () => {
    let goal: number,
      goal2: number,
      epicA: number,
      epicB: number,
      storyA: number,
      storyB: number,
      req: number;
    const base = () => `/projects/${project}`;
    it("creates a persistent goal/epic/story hierarchy with independent status and requirement links", async () => {
      goal = (
        await call("post", base() + "/goals", "manager", {
          title: "Product outcome",
        }).expect(201)
      ).body.id;
      goal2 = (
        await call("post", base() + "/goals", "manager", {
          title: "Second outcome",
        }).expect(201)
      ).body.id;
      epicA = (
        await call("post", base() + "/epics", "manager", {
          title: "First epic",
          goalId: goal,
        }).expect(201)
      ).body.id;
      epicB = (
        await call("post", base() + "/epics", "manager", {
          title: "Empty epic",
          goalId: goal2,
        }).expect(201)
      ).body.id;
      req = (
        await call("post", base() + "/requirements", "manager", {
          title: "Formal requirement",
        }).expect(201)
      ).body.id;
      storyA = (
        await call("post", base() + "/stories", "manager", {
          title: "  Story one  ",
          epicId: epicA,
          description: "As a user",
          acceptanceCriteria: "Observable result",
          requirementIds: [req],
        }).expect(201)
      ).body.id;
      storyB = (
        await call("post", base() + "/stories", "manager", {
          title: "Story two",
          epicId: epicA,
        }).expect(201)
      ).body.id;
      const detail = (
        await call("get", base() + `/stories/${storyA}`, "member").expect(200)
      ).body;
      expect(detail).toMatchObject({
        title: "Story one",
        status: "TODO",
        epicId: epicA,
        sortOrder: 0,
        revision: 0,
        requirementIds: [req],
      });
      expect(
        (
          await call("get", base() + `/requirements/${req}`, "member").expect(
            200,
          )
        ).body.storyIds,
      ).toEqual([storyA]);
      expect(
        (await call("get", base() + "/story-map", "member").expect(200)).body
          .stories,
      ).toHaveLength(2);
    });
    it("persists goal and epic edits and sibling ordering with revision conflicts", async () => {
      await call("patch", base() + `/goals/${goal2}`, "manager", {
        title: "Renamed outcome",
        sortOrder: 0,
        revision: 0,
      }).expect(200);
      const goals = (await call("get", base() + "/goals", "member").expect(200))
        .body;
      expect(goals.map((g: { id: number }) => g.id)).toEqual([goal2, goal]);
      await call("patch", base() + `/goals/${goal2}`, "manager", {
        title: "Stale",
        revision: 0,
      }).expect(409);
      await call("patch", base() + `/epics/${epicA}`, "manager", {
        title: "Renamed epic",
        revision: 0,
      }).expect(200);
      expect(
        (await call("get", base() + "/epics", "member").expect(200)).body.find(
          (e: { id: number }) => e.id === epicA,
        ).title,
      ).toBe("Renamed epic");
      const extra = (
        await call("post", base() + "/epics", "manager", {
          title: "Another epic",
          goalId: goal,
        }).expect(201)
      ).body;
      await call("patch", base() + `/epics/${extra.id}`, "manager", {
        sortOrder: 0,
        revision: 0,
      }).expect(200);
      expect(
        (await call("get", base() + "/epics", "member").expect(200)).body
          .filter((e: { goalId: number }) => e.goalId === goal)
          .map((e: { id: number }) => e.id),
      ).toEqual([extra.id, epicA]);
    });
    it("supports same-epic reorder and cross-epic move with contiguous persisted positions", async () => {
      await call("patch", base() + `/stories/${storyB}/move`, "manager", {
        epicId: epicA,
        position: 0,
        revision: 0,
      }).expect(200);
      expect(
        (
          await db.userStory.findMany({
            where: { epicId: epicA },
            orderBy: { sortOrder: "asc" },
          })
        ).map((s) => s.id),
      ).toEqual([storyB, storyA]);
      const current = await db.userStory.findUniqueOrThrow({
        where: { id: storyA },
      });
      await call("patch", base() + `/stories/${storyA}/move`, "manager", {
        epicId: epicB,
        position: 0,
        revision: current.revision,
      }).expect(200);
      const map = (
        await call("get", base() + "/story-map", "member").expect(200)
      ).body;
      expect(
        map.stories.find((s: { id: number }) => s.id === storyA),
      ).toMatchObject({ epicId: epicB, sortOrder: 0 });
      expect(
        map.stories.find((s: { id: number }) => s.id === storyB),
      ).toMatchObject({ epicId: epicA, sortOrder: 0 });
    });
    it("changes only story status and rejects concurrent stale writes", async () => {
      const task = await db.task.create({
        data: { projectId: project, title: "Unchanged task" },
      });
      await db.storyTask.create({
        data: { projectId: project, storyId: storyA, taskId: task.id },
      });
      const current = await db.userStory.findUniqueOrThrow({
        where: { id: storyA },
      });
      const results = await Promise.all(
        ["IN_PROGRESS", "DONE"].map((status) =>
          call("patch", base() + `/stories/${storyA}/status`, "manager", {
            status,
            revision: current.revision,
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const persisted = await db.userStory.findUniqueOrThrow({
        where: { id: storyA },
      });
      expect(["IN_PROGRESS", "DONE"]).toContain(persisted.status);
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status,
      ).toBe("TODO");
      expect(
        (
          await call("get", base() + "/stories", "member").expect(200)
        ).body.find((s: { id: number }) => s.id === storyA).status,
      ).toBe(persisted.status);
    });
    it("edits content and replaces requirement links from both sides atomically", async () => {
      let current = await db.userStory.findUniqueOrThrow({
        where: { id: storyA },
      });
      await call("patch", base() + `/stories/${storyA}`, "manager", {
        revision: current.revision,
        title: "Edited story",
        acceptanceCriteria: "Updated criteria",
        requirementIds: [],
      }).expect(200);
      expect(
        (
          await call("get", base() + `/requirements/${req}`, "member").expect(
            200,
          )
        ).body.storyIds,
      ).toEqual([]);
      current = await db.userStory.findUniqueOrThrow({ where: { id: storyA } });
      await call("patch", base() + `/requirements/${req}`, "manager", {
        storyIds: [storyA, storyB],
      }).expect(200);
      const detail = (
        await call("get", base() + `/stories/${storyA}`, "member").expect(200)
      ).body;
      expect(detail).toMatchObject({
        title: "Edited story",
        acceptanceCriteria: "Updated criteria",
        requirementIds: [req],
      });
      expect(detail.revision).toBe(current.revision + 1);
      await call("patch", base() + `/stories/${storyA}`, "manager", {
        revision: current.revision,
        title: "Stale link editor",
      }).expect(409);
    });
    it("enforces read-only developer/tester roles for every phase-one mutation", async () => {
      await call("post", base() + "/members", "manager", {
        userId: tester,
        role: "TESTER",
      }).expect(201);
      for (const who of ["member", "tester"]) {
        for (const resource of [
          "story-map",
          "goals",
          "epics",
          "stories",
          `stories/${storyA}`,
        ])
          await call("get", base() + "/" + resource, who).expect(200);
        await call("post", base() + "/goals", who, { title: "Denied" }).expect(
          403,
        );
        await call("post", base() + "/epics", who, {
          title: "Denied",
          goalId: goal,
        }).expect(403);
        await call("post", base() + "/stories", who, {
          title: "Denied",
          epicId: epicA,
        }).expect(403);
        await call("patch", base() + `/goals/${goal}`, who, {
          title: "Denied",
          revision: 0,
        }).expect(403);
        await call("patch", base() + `/epics/${epicA}`, who, {
          title: "Denied",
          revision: 0,
        }).expect(403);
        await call("patch", base() + `/stories/${storyA}`, who, {
          title: "Denied",
          revision: 0,
        }).expect(403);
        await call("patch", base() + `/stories/${storyA}/status`, who, {
          status: "DONE",
          revision: 0,
        }).expect(403);
        await call("patch", base() + `/stories/${storyA}/move`, who, {
          epicId: epicB,
          position: 0,
          revision: 0,
        }).expect(403);
        await call("patch", base() + `/requirements/${req}`, who, {
          storyIds: [],
        }).expect(403);
      }
      await call("get", base() + "/story-map", "admin").expect(404);
      await call("get", base() + "/story-map").expect(401);
      await call("delete", base() + `/members/${tester}`, "manager").expect(
        200,
      );
      await call("get", base() + "/stories", "tester").expect(404);
    });
    it("rejects cross-project parents/links in APIs and composite database foreign keys", async () => {
      const foreignGoal = (
        await call("post", `/projects/${otherProject}/goals`, "manager_b", {
          title: "Foreign",
        }).expect(201)
      ).body.id;
      const foreignEpic = (
        await call("post", `/projects/${otherProject}/epics`, "manager_b", {
          title: "Foreign",
          goalId: foreignGoal,
        }).expect(201)
      ).body.id;
      const foreignStory = (
        await call("post", `/projects/${otherProject}/stories`, "manager_b", {
          title: "Foreign",
          epicId: foreignEpic,
        }).expect(201)
      ).body.id;
      const foreignReq = (
        await call(
          "post",
          `/projects/${otherProject}/requirements`,
          "manager_b",
          { title: "Foreign" },
        ).expect(201)
      ).body.id;
      await call("post", base() + "/epics", "manager", {
        title: "Forged",
        goalId: foreignGoal,
      }).expect(404);
      await call("post", base() + "/stories", "manager", {
        title: "Forged",
        epicId: foreignEpic,
      }).expect(404);
      await call("post", base() + "/stories", "manager", {
        title: "Forged",
        epicId: epicA,
        requirementIds: [foreignReq],
      }).expect(400);
      const current = await db.userStory.findUniqueOrThrow({
        where: { id: storyA },
      });
      await call("patch", base() + `/stories/${storyA}/move`, "manager", {
        epicId: foreignEpic,
        position: 0,
        revision: current.revision,
      }).expect(404);
      await call("patch", base() + `/requirements/${req}`, "manager", {
        title: "Must rollback",
        storyIds: [foreignStory],
      }).expect(400);
      expect(
        (await db.requirement.findUniqueOrThrow({ where: { id: req } })).title,
      ).toBe("Formal requirement");
      await call(
        "get",
        `/projects/${otherProject}/stories/${storyA}`,
        "manager_b",
      ).expect(404);
      await expect(
        db.epic.create({
          data: { projectId: project, goalId: foreignGoal, title: "DB forged" },
        }),
      ).rejects.toThrow();
      await expect(
        db.userStory.create({
          data: { projectId: project, epicId: foreignEpic, title: "DB forged" },
        }),
      ).rejects.toThrow();
      await expect(
        db.storyRequirement.create({
          data: {
            projectId: project,
            storyId: storyA,
            requirementId: foreignReq,
          },
        }),
      ).rejects.toThrow();
      const task = await db.task.create({
        data: { projectId: otherProject, title: "Foreign task" },
      });
      await expect(
        db.storyTask.create({
          data: { projectId: project, storyId: storyA, taskId: task.id },
        }),
      ).rejects.toThrow();
      // Real many-to-many storage is available for phase 2 without exposing task data in story reads.
      const tasks = await Promise.all(
        [1, 2].map((n) =>
          db.task.create({
            data: { projectId: project, title: `Linked ${n}` },
          }),
        ),
      );
      for (const storyId of [storyA, storyB])
        for (const t of tasks)
          await db.storyTask.create({
            data: { projectId: project, storyId, taskId: t.id },
          });
      expect(
        await db.storyTask.count({
          where: { projectId: project, taskId: { in: tasks.map((t) => t.id) } },
        }),
      ).toBe(4);
      expect(
        (await call("get", base() + `/stories/${storyA}`, "member").expect(200))
          .body,
      ).not.toHaveProperty("taskLinks");
    });
    it("validates nulls, blanks, duplicates, forged status/project and move parameters", async () => {
      for (const data of [
        { title: " " },
        { title: "x".repeat(201) },
        { title: null },
        { title: "Forged", projectId: otherProject },
      ])
        await call("post", base() + "/goals", "manager", data).expect(400);
      for (const data of [
        { title: "X", epicId: epicA, status: "DONE" },
        { title: "X", epicId: epicA, requirementIds: [req, req] },
        { title: "X", epicId: epicA, description: null },
      ])
        await call("post", base() + "/stories", "manager", data).expect(400);
      for (const data of [
        { status: "INVALID", revision: 0 },
        { status: "DONE" },
        { status: null, revision: 0 },
      ])
        await call(
          "patch",
          base() + `/stories/${storyA}/status`,
          "manager",
          data,
        ).expect(400);
      for (const position of [-1, 0.5, null, "1"])
        await call("patch", base() + `/stories/${storyA}/move`, "manager", {
          epicId: epicA,
          position,
          revision: 0,
        }).expect(400);
      await call("patch", base() + `/stories/${storyA}`, "manager", {
        revision: 0,
      }).expect(400);
    });
  });

  describe("V4.3 requirements, execution and UML", () => {
    let root: number,
      child: number,
      leaf: number,
      story: number,
      task: number,
      diagram: number,
      actorNode: number,
      useNode: number,
      otherUse: number;
    const base = () => `/projects/${project}`;
    it("persists three requirement levels and rejects cycles, deeper subtrees and cross-project parents", async () => {
      root = (
        await call("post", base() + "/requirements", "manager", {
          title: "Tree root",
        }).expect(201)
      ).body.id;
      child = (
        await call("post", base() + "/requirements", "manager", {
          title: "Child",
          parentId: root,
        }).expect(201)
      ).body.id;
      leaf = (
        await call("post", base() + "/requirements", "manager", {
          title: "Leaf",
          parentId: child,
        }).expect(201)
      ).body.id;
      expect(
        (
          await call("get", base() + `/requirements/${leaf}`, "member").expect(
            200,
          )
        ).body.parentId,
      ).toBe(child);
      await call("post", base() + "/requirements", "manager", {
        title: "Fourth",
        parentId: leaf,
      }).expect(400);
      await call("patch", base() + `/requirements/${root}`, "manager", {
        parentId: leaf,
      }).expect(400);
      await call("patch", base() + `/requirements/${child}`, "manager", {
        parentId: child,
      }).expect(400);
      const foreign = (
        await call(
          "post",
          `/projects/${otherProject}/requirements`,
          "manager_b",
          { title: "Other root" },
        ).expect(201)
      ).body.id;
      await call("patch", base() + `/requirements/${root}`, "manager", {
        parentId: foreign,
      }).expect(400);
      const newRoot = (
        await call("post", base() + "/requirements", "manager", {
          title: "New root",
        }).expect(201)
      ).body.id;
      await call("patch", base() + `/requirements/${root}`, "manager", {
        parentId: newRoot,
      }).expect(400);
      await call("patch", base() + `/requirements/${leaf}`, "manager", {
        parentId: root,
      }).expect(200);
      await call("patch", base() + `/requirements/${child}`, "member", {
        parentId: null,
      }).expect(403);
    });
    it("creates full tasks with real story associations and a creation history", async () => {
      const goal = (
        await call("post", base() + "/goals", "manager", {
          title: "Execution",
        }).expect(201)
      ).body;
      const epic = (
        await call("post", base() + "/epics", "manager", {
          title: "Execution epic",
          goalId: goal.id,
        }).expect(201)
      ).body;
      story = (
        await call("post", base() + "/stories", "manager", {
          title: "Story for task",
          epicId: epic.id,
          requirementIds: [leaf],
        }).expect(201)
      ).body.id;
      task = (
        await call("post", base() + "/tasks", "manager", {
          title: "Full task",
          description: "Execution details",
          priority: "URGENT",
          assigneeUserId: member,
          storyIds: [story],
        }).expect(201)
      ).body.id;
      const detail = (
        await call("get", base() + `/tasks/${task}`, "member").expect(200)
      ).body;
      expect(detail).toMatchObject({
        priority: "URGENT",
        progress: 0,
        status: "TODO",
        storyIds: [story],
        planIds: [],
        revision: 0,
        archivedAt: null,
      });
      expect(
        (
          await call("get", base() + `/tasks/${task}/history`, "member").expect(
            200,
          )
        ).body[0],
      ).toMatchObject({ actorUserId: manager, action: "创建任务" });
      await call("patch", base() + `/tasks/${task}`, "member", {
        priority: "LOW",
      }).expect(403);
      await call("patch", base() + `/tasks/${task}/assignee`, "member", {
        assigneeUserId: manager,
      }).expect(403);
      await call("patch", base() + `/tasks/${task}/progress`, "member", {
        progress: 20,
      }).expect(400);
      await call("post", base() + "/tasks", "manager", {
        title: "Blocked plan link",
        planIds: ["A-opaque-plan"],
      }).expect(400);
      expect(
        await db.task.count({ where: { title: "Blocked plan link" } }),
      ).toBe(0);
    });
    it("enforces TODO=0, IN_PROGRESS=0-99, DONE=100 and manager-only reopening", async () => {
      await call("patch", base() + `/tasks/${task}/status`, "member", {
        status: "IN_PROGRESS",
        revision: 0,
      }).expect(200);
      await call("patch", base() + `/tasks/${task}/progress`, "member", {
        progress: 45,
        revision: 1,
      }).expect(200);
      await call("patch", base() + `/tasks/${task}/progress`, "member", {
        progress: 100,
      }).expect(400);
      await call("patch", base() + `/tasks/${task}/progress`, "member", {
        progress: -1,
      }).expect(400);
      await call("patch", base() + `/tasks/${task}/progress`, "member", {
        progress: 30,
        priority: "LOW",
      }).expect(400);
      await call("patch", base() + `/tasks/${task}/status`, "member", {
        status: "DONE",
        revision: 2,
      }).expect(200);
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: task } })).progress,
      ).toBe(100);
      await call("patch", base() + `/tasks/${task}/status`, "member", {
        status: "IN_PROGRESS",
        revision: 3,
      }).expect(403);
      await call("patch", base() + `/tasks/${task}/status`, "manager", {
        status: "IN_PROGRESS",
        revision: 3,
      }).expect(200);
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: task } })).progress,
      ).toBe(0);
      await call("patch", base() + `/tasks/${task}/progress`, "manager", {
        progress: 70,
        revision: 4,
      }).expect(200);
      await call("patch", base() + `/tasks/${task}/status`, "member", {
        status: "TODO",
        revision: 5,
      }).expect(200);
      expect(
        (await db.task.findUniqueOrThrow({ where: { id: task } })).progress,
      ).toBe(0);
      await expect(
        db.task.update({
          where: { id: task },
          data: { status: "DONE", progress: 10 },
        }),
      ).rejects.toThrow();
      await expect(
        db.task.update({ where: { id: task }, data: { priority: "CRITICAL" } }),
      ).rejects.toThrow();
    });
    it("rejects stale edits and cross-project relations, records changes and archive/restore", async () => {
      const current = await db.task.findUniqueOrThrow({ where: { id: task } });
      const results = await Promise.all(
        ["Edited A", "Edited B"].map((title) =>
          call("patch", base() + `/tasks/${task}`, "manager", {
            title,
            revision: current.revision,
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const otherGoal = (
        await call("post", `/projects/${otherProject}/goals`, "manager_b", {
          title: "Foreign task goal",
        }).expect(201)
      ).body;
      const otherEpic = (
        await call("post", `/projects/${otherProject}/epics`, "manager_b", {
          title: "Foreign task epic",
          goalId: otherGoal.id,
        }).expect(201)
      ).body;
      const foreign = (
        await call("post", `/projects/${otherProject}/stories`, "manager_b", {
          title: "Foreign task story",
          epicId: otherEpic.id,
        }).expect(201)
      ).body;
      await call("patch", base() + `/tasks/${task}`, "manager", {
        storyIds: [foreign.id],
      }).expect(400);
      await call(
        "post",
        base() + `/tasks/${task}/archive`,
        "member",
        {},
      ).expect(403);
      await call(
        "post",
        base() + `/tasks/${task}/archive`,
        "manager",
        {},
      ).expect(201);
      expect(
        (await call("get", base() + "/tasks", "manager").expect(200)).body.some(
          (t: { id: number }) => t.id === task,
        ),
      ).toBe(false);
      expect(
        (
          await call("get", base() + "/tasks?archived=true", "manager").expect(
            200,
          )
        ).body.some((t: { id: number }) => t.id === task),
      ).toBe(true);
      expect(
        (
          await call("get", base() + "/tasks/mine", "member").expect(200)
        ).body.some((t: { id: number }) => t.id === task),
      ).toBe(false);
      await call("patch", base() + `/tasks/${task}/status`, "manager", {
        status: "DONE",
      }).expect(400);
      await call(
        "post",
        base() + `/tasks/${task}/restore`,
        "manager",
        {},
      ).expect(201);
      const history = (
        await call("get", base() + `/tasks/${task}/history`, "manager").expect(
          200,
        )
      ).body;
      expect(history.map((h: { action: string }) => h.action)).toEqual(
        expect.arrayContaining([
          "创建任务",
          "修改状态",
          "更新完成进度",
          "编辑任务与关联",
          "归档任务",
          "恢复任务",
        ]),
      );
      await call("get", base() + `/tasks/${task}`, "manager_b").expect(404);
      await call("get", base() + `/tasks/${task}`, "admin").expect(404);
    });
    it("scopes member graph on the server and revokes old-owner writes after reassignment", async () => {
      const managerTask = (
        await call("post", base() + "/tasks", "manager", {
          title: "Manager private graph",
          assigneeUserId: manager,
        }).expect(201)
      ).body;
      const graph = (
        await call("get", base() + "/tasks/graph", "member").expect(200)
      ).body;
      expect(graph.tasks.some((t: { id: number }) => t.id === task)).toBe(true);
      expect(
        graph.tasks.some((t: { id: number }) => t.id === managerTask.id),
      ).toBe(false);
      expect(
        graph.members.every((m: { userId: number }) => m.userId === member),
      ).toBe(true);
      await call("post", base() + "/members", "manager", {
        userId: tester,
        role: "TESTER",
      }).expect(201);
      await call("patch", base() + `/tasks/${task}/assignee`, "manager", {
        assigneeUserId: tester,
      }).expect(200);
      await call("patch", base() + `/tasks/${task}/status`, "member", {
        status: "IN_PROGRESS",
      }).expect(404);
      await call("get", base() + `/tasks/${task}/history`, "member").expect(
        404,
      );
      await call("patch", base() + `/tasks/${task}/status`, "tester", {
        status: "IN_PROGRESS",
      }).expect(200);
      expect(
        (
          await call("get", base() + "/tasks/mine", "tester").expect(200)
        ).body.some((t: { id: number }) => t.id === task),
      ).toBe(true);
    });
    it("persists editable UML nodes, story links, three edge types and boundary layout", async () => {
      const diagrams = (
        await call("get", base() + "/uml-diagrams", "manager").expect(200)
      ).body;
      expect(diagrams.length).toBeGreaterThan(0);
      diagram = diagrams[0].id;
      const path = base() + `/uml-diagrams/${diagram}`;
      let result = (
        await call("post", path + "/nodes", "manager", {
          kind: "ACTOR",
          name: "Project member",
          x: 115,
          y: 120,
        }).expect(201)
      ).body;
      actorNode = result.nodes.find(
        (n: { name: string }) => n.name === "Project member",
      ).id;
      result = (
        await call("post", path + "/nodes", "manager", {
          kind: "USE_CASE",
          name: "Submit work",
          x: 476,
          y: 100,
          storyIds: [story],
        }).expect(201)
      ).body;
      useNode = result.nodes.find(
        (n: { name: string }) => n.name === "Submit work",
      ).id;
      result = (
        await call("post", path + "/nodes", "manager", {
          kind: "USE_CASE",
          name: "Validate work",
          x: 476,
          y: 220,
        }).expect(201)
      ).body;
      otherUse = result.nodes.find(
        (n: { name: string }) => n.name === "Validate work",
      ).id;
      await call("post", path + "/edges", "manager", {
        fromId: actorNode,
        toId: useNode,
        kind: "association",
      }).expect(201);
      await call("post", path + "/edges", "manager", {
        fromId: useNode,
        toId: otherUse,
        kind: "include",
      }).expect(201);
      result = (
        await call("post", path + "/edges", "manager", {
          fromId: otherUse,
          toId: useNode,
          kind: "extend",
        }).expect(201)
      ).body;
      await call("patch", path + `/nodes/${useNode}`, "manager", {
        x: 510,
        y: 160,
        revision: 0,
      }).expect(200);
      await call("patch", path + `/nodes/${useNode}`, "manager", {
        x: 520,
        revision: 0,
      }).expect(409);
      result = (
        await call("get", base() + "/uml-diagrams", "member").expect(200)
      ).body.find((d: { id: number }) => d.id === diagram);
      expect(
        result.nodes.find((n: { id: number }) => n.id === useNode),
      ).toMatchObject({ x: 510, y: 160, storyIds: [story] });
      expect(result.edges.map((e: { kind: string }) => e.kind).sort()).toEqual([
        "association",
        "extend",
        "include",
      ]);
      await call("patch", path + "/boundary", "manager", {
        name: "Verified system",
        x: 240,
        y: 40,
        width: 500,
        height: 420,
        revision: result.revision,
      }).expect(200);
      expect(
        (
          await call("get", base() + "/uml-diagrams", "tester").expect(200)
        ).body.find((d: { id: number }) => d.id === diagram).boundary.name,
      ).toBe("Verified system");
      await call("post", path + "/edges", "manager", {
        fromId: actorNode,
        toId: useNode,
        kind: "include",
      }).expect(400);
      await call("post", path + "/nodes", "manager", {
        kind: "ACTOR",
        name: "Invalid story actor",
        x: 20,
        y: 20,
        storyIds: [story],
      }).expect(400);
    });
    it("enforces UML project/diagram/role boundaries and supports multiple diagrams", async () => {
      const second = (
        await call("post", base() + "/uml-diagrams", "manager", {
          name: "Second diagram",
        }).expect(201)
      ).body;
      const secondNode = (
        await call(
          "post",
          base() + `/uml-diagrams/${second.id}/nodes`,
          "manager",
          { kind: "USE_CASE", name: "Other scene node", x: 400, y: 100 },
        ).expect(201)
      ).body.nodes[0];
      await call("post", base() + `/uml-diagrams/${diagram}/edges`, "manager", {
        fromId: useNode,
        toId: secondNode.id,
        kind: "include",
      }).expect(400);
      for (const who of ["member", "tester"]) {
        await call("post", base() + "/uml-diagrams", who, {
          name: "Denied",
        }).expect(403);
        await call(
          "patch",
          base() + `/uml-diagrams/${diagram}/nodes/${useNode}`,
          who,
          { name: "Denied", revision: 1 },
        ).expect(403);
        await call(
          "delete",
          base() + `/uml-diagrams/${diagram}/nodes/${useNode}`,
          who,
        ).expect(403);
      }
      await call("get", base() + "/uml-diagrams", "admin").expect(404);
      await call(
        "post",
        `/projects/${otherProject}/uml-diagrams/${diagram}/nodes`,
        "manager_b",
        { kind: "ACTOR", name: "Forged", x: 20, y: 20 },
      ).expect(404);
      await call(
        "delete",
        base() + `/uml-diagrams/${second.id}/nodes/${secondNode.id}`,
        "manager",
      ).expect(200);
    });
    it("resolves real story/task/use-case relationships without exposing other assignees", async () => {
      const result = (
        await call(
          "get",
          base() + `/relations/resolve?entityType=story&entityId=${story}`,
          "manager",
        ).expect(200)
      ).body;
      expect(result.stories).toContain(story);
      expect(result.tasks).toContain(task);
      expect(result.umlUseCases).toContain(useNode);
      const reverse = (
        await call(
          "get",
          base() +
            `/relations/resolve?entityType=umlUseCase&entityId=${useNode}`,
          "tester",
        ).expect(200)
      ).body;
      expect(reverse.stories).toContain(story);
      expect(reverse.tasks).toContain(task);
      const denied = (
        await call(
          "get",
          base() + `/relations/resolve?entityType=story&entityId=${story}`,
          "member",
        ).expect(200)
      ).body;
      expect(denied.tasks).not.toContain(task);
      await call(
        "get",
        base() + `/relations/resolve?entityType=task&entityId=${task}`,
        "member",
      ).expect(404);
      const plans = (
        await call("get", base() + "/plan-adapter", "manager").expect(200)
      ).body;
      expect(plans).toMatchObject({ available: true, stages: [], items: [] });
    });
  });
});
