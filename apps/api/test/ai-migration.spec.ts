import "reflect-metadata";
import "../src/environment";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { DbService } from "../src/db/db.module";

it("M1 preserves every existing Sprint 2 table row and column on a populated database; repeated deploy has no drift", async () => {
  const original = process.env.DATABASE_URL!;
  if (!["localhost", "127.0.0.1"].includes(new URL(original).hostname))
    throw new Error("Local PostgreSQL required");
  const schema = "spm_ai_upgrade_" + randomBytes(8).toString("hex"),
    pool = new Pool({ connectionString: original });
  const url = new URL(original);
  url.searchParams.set("schema", schema);
  const runtimeRoot = resolve(".runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  const temp = mkdtempSync(join(runtimeRoot, "ai-upgrade-"));
  const migrationRoot = resolve("prisma/migrations"),
    target = join(temp, "migrations");
  mkdirSync(target);
  const m1 = "202610230001_ai_foundation",
    cli = resolve("node_modules/prisma/build/index.js");
  let db: DbService | undefined, fixture: Pool | undefined;
  const config = join(temp, "prisma.config.ts");
  writeFileSync(
    config,
    `import {defineConfig} from 'prisma/config';export default defineConfig(${JSON.stringify({ schema: resolve("prisma/schema.prisma"), migrations: { path: target }, datasource: { url: url.toString() } })});`,
  );
  const deploy = () =>
    execFileSync(
      process.execPath,
      [cli, "migrate", "deploy", "--config", config],
      { env: process.env, stdio: "pipe" },
    );
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    process.env.DATABASE_URL = url.toString();
    for (const entry of readdirSync(migrationRoot))
      if (entry !== m1 && entry !== "202610240001_ai_planning")
        cpSync(join(migrationRoot, entry), join(target, entry), {
          recursive: true,
        });
    deploy();
    db = new DbService();
    await db.onModuleInit();
    const user = await db.user.create({
      data: {
        username: "existing-manager",
        passwordHash: "existing-private-hash",
        role: "MANAGER",
      },
    });
    const p = await db.project.create({
      data: {
        name: "Existing S2 project",
        managerId: user.id,
        members: { create: { userId: user.id, role: "MANAGER" } },
      },
    });
    const parent = (
      await db.$queryRaw<
        { id: number }[]
      >`INSERT INTO "Requirement" ("projectId",title,"updatedAt") VALUES (${p.id},'Existing parent',CURRENT_TIMESTAMP) RETURNING id`
    )[0];
    const child = (
      await db.$queryRaw<
        { id: number }[]
      >`INSERT INTO "Requirement" ("projectId","parentId",title,"updatedAt") VALUES (${p.id},${parent.id},'Existing child',CURRENT_TIMESTAMP) RETURNING id`
    )[0];
    const goal = await db.productGoal.create({
      data: { projectId: p.id, title: "Existing goal" },
    });
    const epic = await db.epic.create({
      data: { projectId: p.id, goalId: goal.id, title: "Existing epic" },
    });
    const story = await db.userStory.create({
      data: {
        projectId: p.id,
        epicId: epic.id,
        title: "Existing story",
        status: "IN_PROGRESS",
      },
    });
    await db.storyRequirement.create({
      data: { projectId: p.id, storyId: story.id, requirementId: child.id },
    });
    const task = await db.task.create({
      data: {
        projectId: p.id,
        title: "Existing task",
        assigneeUserId: user.id,
        status: "IN_PROGRESS",
        progress: 45,
      },
    });
    await db.storyTask.create({
      data: { projectId: p.id, storyId: story.id, taskId: task.id },
    });
    const stage = await db.planStage.create({
      data: {
        projectId: p.id,
        title: "Existing stage",
        start: "2026-10-01",
        end: "2026-10-30",
      },
    });
    const item = await db.planItem.create({
      data: {
        projectId: p.id,
        stageId: stage.id,
        title: "Existing plan",
        start: "2026-10-02",
        end: "2026-10-03",
      },
    });
    await db.taskPlanReference.create({
      data: { projectId: p.id, taskId: task.id, planId: item.id },
    });
    const diagram = await db.umlDiagram.create({
      data: { projectId: p.id, name: "Existing UML" },
    });
    const node = await db.umlNode.create({
      data: {
        projectId: p.id,
        diagramId: diagram.id,
        kind: "USE_CASE",
        name: "Existing use case",
        x: 1,
        y: 2,
      },
    });
    await db.umlStory.create({
      data: { projectId: p.id, nodeId: node.id, storyId: story.id },
    });
    await db.projectDocument.create({
      data: {
        projectId: p.id,
        kind: "FILE",
        name: "existing.txt",
        mime: "text/plain",
        content: Buffer.from("keep me"),
        size: 7,
        ownerUserId: user.id,
        ownerName: user.username,
      },
    });
    fixture = new Pool({
      connectionString: url.toString(),
      options: `-c search_path=${schema}`,
    });
    const tables = (
      await fixture.query(
        "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
        [schema],
      )
    ).rows.map((r) => r.tablename as string);
    const rows = () =>
      Promise.all(
        tables.map((t) =>
          fixture!
            .query(
              `SELECT to_jsonb(t) AS row FROM "${t}" t ORDER BY to_jsonb(t)::text`,
            )
            .then((r) => r.rows),
        ),
      );
    const columns = () =>
      fixture!
        .query(
          "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name NOT IN ('AiAnalysisRun','AiRiskFinding','_prisma_migrations') ORDER BY table_name,ordinal_position",
          [schema],
        )
        .then((r) => r.rows);
    const before = await rows(),
      beforeColumns = await columns();
    cpSync(join(migrationRoot, m1), join(target, m1), { recursive: true });
    deploy();
    deploy();
    expect(await rows()).toEqual(before);
    expect(await columns()).toEqual(beforeColumns);
    expect(await db.aiAnalysisRun.count()).toBe(0);
    expect(await db.aiRiskFinding.count()).toBe(0);
    const m2 = "202610240001_ai_planning";
    cpSync(join(migrationRoot, m2), join(target, m2), { recursive: true });
    deploy();
    deploy();
    expect(await db.aiDraft.count()).toBe(0);
    expect(
      (await db.requirement.findMany()).every(
        (r) => r.acceptanceCriteria === "" && r.revision === 0,
      ),
    ).toBe(true);
    const afterM2 = await rows();
    const requirementIndex = tables.indexOf("Requirement");
    afterM2[requirementIndex] = afterM2[requirementIndex].map((record) => {
      const { acceptanceCriteria, revision, ...old } = record.row;
      return { row: old };
    });
    expect(afterM2).toEqual(before);
    execFileSync(
      process.execPath,
      [
        cli,
        "migrate",
        "diff",
        "--config",
        config,
        "--from-config-datasource",
        "--to-schema",
        resolve("prisma/schema.prisma"),
        "--exit-code",
      ],
      { env: process.env, stdio: "pipe" },
    );
  } finally {
    if (db) await db.onModuleDestroy();
    if (fixture) await fixture.end();
    process.env.DATABASE_URL = original;
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    if (temp.startsWith(runtimeRoot + sep))
      rmSync(temp, { recursive: true, force: true });
  }
});
