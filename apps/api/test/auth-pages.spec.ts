import "reflect-metadata";
import "../src/environment";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { DbService } from "../src/db/db.module";
import { tokenHash } from "../src/common/security";


describe("V4.3 actual account registration and password recovery", () => {
  let app: INestApplication, db: DbService, pool: Pool;
  const schema = "spm_auth_" + randomBytes(8).toString("hex");
  const originalUrl = process.env.DATABASE_URL!;
  const saved = { ...process.env };
  const password = randomBytes(24).toString("hex");
  const invite = randomBytes(24).toString("hex");
  const payload = {
    username: "auth_registered",
    email: "auth@example.test",
    password,
    inviteCode: invite,
  };
  const call = (path: string, body: object) =>
    request(app.getHttpServer())
      .post("/api/auth/" + path)
      .set("X-SPM-Request", "1")
      .set("Origin", "http://127.0.0.1:5173")
      .send(body);
  beforeAll(async () => {
    if (
      !originalUrl ||
      !["127.0.0.1", "localhost"].includes(new URL(originalUrl).hostname)
    )
      throw new Error("Local PostgreSQL required");
    pool = new Pool({ connectionString: originalUrl });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(originalUrl);
    url.searchParams.set("schema", schema);
    process.env.DATABASE_URL = url.toString();
    process.env.WEB_ORIGIN = "http://127.0.0.1:5173";
    process.env.REGISTRATION_INVITE_CODE = invite;
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
    process.env.AUTH_MAIL_MODE = "simulation";
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configure(module.createNestApplication());
    await app.init();
    db = app.get(DbService);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
    for (const name of [
      "DATABASE_URL",
      "WEB_ORIGIN",
      "REGISTRATION_INVITE_CODE",
      "AUTH_MAIL_MODE",
      "NODE_ENV",
    ]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  it("validates invitations and fields; grants MEMBER only and keeps credentials private", async () => {
    delete process.env.REGISTRATION_INVITE_CODE;
    await call("register", payload).expect(503);
    process.env.REGISTRATION_INVITE_CODE = invite;
    await call("register", { ...payload, inviteCode: "invalid" }).expect(403);
    await call("register", { ...payload, email: "bad" }).expect(400);
    await call("register", { ...payload, password: "short" }).expect(400);
    await call("register", { ...payload, role: "ADMIN" }).expect(400);
    const created = await call("register", {
      ...payload,
      email: "AUTH@example.test",
    }).expect(201);
    expect(created.body).toMatchObject({
      username: payload.username,
      role: "MEMBER",
      active: true,
    });
    expect(created.body.passwordHash).toBeUndefined();
    expect(created.body.email).toBeUndefined();
    const user = await db.user.findUniqueOrThrow({
      where: { username: payload.username },
    });
    expect(user.email).toBe(payload.email);
    expect(user.passwordHash).not.toBe(password);
    await call("register", payload).expect(409);
    await call("register", { ...payload, username: "other_username" }).expect(
      409,
    );
  });
  it("simulates an email with a hashed, single-use token and revokes old sessions on reset", async () => {
    const login = await call("login", {
      username: payload.username,
      password,
    }).expect(201);
    const response = await call("forgot-password", {
      username: payload.username,
      email: payload.email,
    }).expect(201);
    expect(response.body.message).toContain("未发送真实邮件");
    const token = response.body.simulatedResetUrl.split("token=")[1];
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const stored = await db.passwordReset.findUniqueOrThrow({
      where: { id: tokenHash(token) },
    });
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await call("forgot-password", {
      username: payload.username,
      email: payload.email,
    }).expect(201);

    const newPassword = randomBytes(24).toString("hex");
    await call("reset-password", { token, password: newPassword }).expect(201);
    await call("reset-password", { token, password: newPassword }).expect(400);
    await call("login", { username: payload.username, password }).expect(401);
    await call("login", {
      username: payload.username,
      password: newPassword,
    }).expect(201);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", login.headers["set-cookie"][0].split(";")[0])
      .expect(401);
    expect(await db.passwordReset.count()).toBe(0);
  });
  it("returns no link for mismatched accounts and disables the simulation in production", async () => {
    const a = await call("forgot-password", {
      username: "missing",
      email: payload.email,
    }).expect(201);
    const b = await call("forgot-password", {
      username: payload.username,
      email: "wrong@example.test",
    }).expect(201);
    expect(a.body).toEqual(b.body);

    process.env.NODE_ENV = "production";
    await call("forgot-password", {
      username: payload.username,
      email: payload.email,
    }).expect(503);
    process.env.NODE_ENV = saved.NODE_ENV || "test";
  });
  it("rejects expired links, inactive accounts and tokens invalidated by an administrator password change", async () => {
    const user = await db.user.findUniqueOrThrow({
      where: { username: payload.username },
    });
    const token = randomBytes(32).toString("hex");
    await db.passwordReset.create({
      data: {
        id: tokenHash(token),
        userId: user.id,
        passwordHash: user.passwordHash,
        expiresAt: new Date(Date.now() - 1),
      },
    });
    await call("reset-password", { token, password }).expect(400);
    await db.passwordReset.update({
      where: { id: tokenHash(token) },
      data: {
        expiresAt: new Date(Date.now() + 60000),
        passwordHash: "obsolete",
      },
    });
    await call("reset-password", { token, password }).expect(400);
    await db.passwordReset.update({
      where: { id: tokenHash(token) },
      data: { passwordHash: user.passwordHash },
    });
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    await call("reset-password", { token, password }).expect(400);
    await call("reset-password", {
      username: payload.username,
      password,
    }).expect(400);
  });
});
