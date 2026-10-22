const assert = require("node:assert/strict");
const fs = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium, request } = require("playwright");
const { Pool } = require("../apps/api/node_modules/pg");
require("../apps/api/node_modules/reflect-metadata");
require("../apps/api/node_modules/dotenv").config({
  path: resolve(".env"),
  quiet: true,
});
(async () => {
  const original = process.env.DATABASE_URL;
  assert(
    original && ["127.0.0.1", "localhost"].includes(new URL(original).hostname),
  );
  const schema = "spm_auth_browser_" + randomBytes(8).toString("hex");
  const pool = new Pool({ connectionString: original });
  const url = new URL(original);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  const dir = ".runtime/auth-audit";
  fs.mkdirSync(dir, { recursive: true });
  const checks = [],
    errors = [];
  const pass = (text) => {
    checks.push(text);
    console.log("PASS", text);
  };
  let app, vite, browser, oldSession;
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
    process.env.WEB_ORIGIN = "http://127.0.0.1:5175";
    process.env.REGISTRATION_INVITE_CODE = randomBytes(24).toString("hex");
    process.env.AUTH_MAIL_MODE = "simulation";
    const { NestFactory } = require("../apps/api/node_modules/@nestjs/core");
    const { AppModule } = require("../apps/api/dist/app.module");
    const { configure } = require("../apps/api/dist/bootstrap");
    const { DbService } = require("../apps/api/dist/db/db.module");
    app = configure(await NestFactory.create(AppModule, { logger: false }));
    await app.listen(3002, "127.0.0.1");
    const db = app.get(DbService);
    const { createServer } = await import(
      pathToFileURL(require.resolve("vite", { paths: [resolve("apps/web")] }))
        .href
    );
    vite = await createServer({
      configFile: false,
      root: resolve("apps/web"),
      server: {
        host: "127.0.0.1",
        port: 5175,
        strictPort: true,
        proxy: {
          "/api": { target: "http://127.0.0.1:3002", changeOrigin: true },
        },
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
    page.on("pageerror", (error) => errors.push(error.message));
    const shot = (name) =>
      page.screenshot({
        path: `${dir}/after-${name}.png`,
        animations: "disabled",
      });
    await page.goto("http://127.0.0.1:5175/");
    await page.getByRole("heading", { name: "欢迎登录爱管理" }).waitFor();
    assert.ok((await page.locator(".eye-btn path").boundingBox()).width > 10);
    await shot("login");
    await page.getByRole("button", { name: "登 录", exact: true }).click();
    await page.getByText("请输入用户名", { exact: true }).waitFor();
    await page.getByRole("button", { name: "注册账号", exact: true }).click();
    await page.getByRole("heading", { name: "注册爱管理账号" }).waitFor();
    await shot("register");
    const password = randomBytes(24).toString("hex"),
      nextPassword = randomBytes(24).toString("hex");
    await page.getByLabel("用户名", { exact: true }).fill("auth_browser");
    await page
      .getByLabel("邮箱", { exact: true })
      .fill("auth-browser@example.test");
    await page.getByLabel("设置密码", { exact: true }).fill(password);
    await page.getByLabel("确认密码", { exact: true }).fill("mismatch");
    await page.getByLabel("管理员邀请码", { exact: true }).fill("invalid");
    await page.getByRole("button", { name: "提交注册申请" }).click();
    await page.getByText("两次输入的密码不一致").waitFor();
    await page.getByLabel("确认密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "显示设置密码" }).click();
    assert.equal(
      await page.getByLabel("设置密码", { exact: true }).getAttribute("type"),
      "text",
    );
    await page.getByRole("button", { name: "隐藏设置密码" }).click();
    await page.getByRole("button", { name: "提交注册申请" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "管理员邀请码无效" })
      .waitFor();
    await page
      .getByLabel("管理员邀请码", { exact: true })
      .fill(process.env.REGISTRATION_INVITE_CODE);
    await page.getByRole("button", { name: "提交注册申请" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "账号注册成功" })
      .waitFor();
    const user = await db.user.findUniqueOrThrow({
      where: { username: "auth_browser" },
    });
    assert.equal(user.role, "MEMBER");
    assert.equal(user.email, "auth-browser@example.test");
    assert.notEqual(user.passwordHash, password);
    pass(
      "Registration fields, confirmation, password visibility, rejected invitation and real MEMBER account persistence",
    );
    await page.getByRole("button", { name: "返回登录", exact: true }).click();
    await page.getByRole("button", { name: "忘记密码？" }).click();
    await page.getByRole("heading", { name: "找回登录密码" }).waitFor();
    await page.getByLabel("用户名", { exact: true }).fill("");
    await page.getByLabel("已绑定邮箱").fill("");
    await shot("forgot");
    await page.getByLabel("用户名", { exact: true }).fill("auth_browser");
    await page.getByLabel("已绑定邮箱").fill("wrong@example.test");
    await page.getByRole("button", { name: "申请密码重置" }).click();
    await page.getByRole("status").waitFor();
    assert.equal(await page.getByRole("link", { name: "打开模拟邮件中的重置链接" }).count(), 0);
    await page.getByLabel("已绑定邮箱").fill("auth-browser@example.test");
    await page.getByRole("button", { name: "申请密码重置" }).click();
    await page.getByRole("status").waitFor();
    await page.getByRole("link", { name: "打开模拟邮件中的重置链接" }).waitFor();
    await shot("simulated-mail");
    pass(
      "Forgot password verifies username/email and displays an explicitly simulated email/reset link without external delivery",
    );
    oldSession = await request.newContext({
      baseURL: "http://127.0.0.1:3002",
      extraHTTPHeaders: {
        "X-SPM-Request": "1",
        Origin: process.env.WEB_ORIGIN,
      },
    });
    assert.equal(
      (
        await oldSession.post("/api/auth/login", {
          data: { username: "auth_browser", password },
        })
      ).status(),
      201,
    );
    const token = (await page.getByRole("link", { name: "打开模拟邮件中的重置链接" }).getAttribute("href")).split("token=")[1];
    await page.getByRole("link", { name: "打开模拟邮件中的重置链接" }).click();
    await page.getByRole("heading", { name: "设置新密码" }).waitFor();
    await shot("reset");
    await page.getByLabel("新密码", { exact: true }).fill(nextPassword);
    await page.getByLabel("确认新密码", { exact: true }).fill(nextPassword);
    await page.getByRole("button", { name: "重置密码", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "密码已重置" }).waitFor();
    assert.equal((await oldSession.get("/api/auth/me")).status(), 401);
    assert.equal(
      (
        await oldSession.post("/api/auth/reset-password", {
          data: { token, password },
        })
      ).status(),
      400,
    );
    assert.equal(
      (
        await oldSession.post("/api/auth/login", {
          data: { username: "auth_browser", password },
        })
      ).status(),
      401,
    );
    pass(
      "Simulated email link resets the actual password once, rejects reuse and invalidates the old authenticated session",
    );
    await page.getByRole("button", { name: "← 返回登录" }).click();
    await page.getByLabel("用户名", { exact: true }).fill("auth_browser");
    await page.getByLabel("密码", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "登 录", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "用户名或密码错误" })
      .waitFor();
    await page.getByLabel("密码", { exact: true }).fill(nextPassword);
    await page.getByRole("button", { name: "登 录", exact: true }).click();
    await page
      .getByRole("heading", { name: "我的项目", exact: true })
      .waitFor();
    pass(
      "Existing login failure handling and successful new-password login enter the actual authorized project page",
    );
    const anonymous = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    anonymous.on("pageerror", (error) => errors.push(error.message));
    await anonymous.goto("http://127.0.0.1:5175/#forgot");
    await anonymous.getByRole("heading", { name: "找回登录密码" }).waitFor();
    delete process.env.AUTH_MAIL_MODE;
    await anonymous.getByLabel("用户名", { exact: true }).fill("auth_browser");
    await anonymous.getByLabel("已绑定邮箱").fill("auth-browser@example.test");
    await anonymous.getByRole("button", { name: "申请密码重置" }).click();
    await anonymous
      .getByRole("alert")
      .filter({ hasText: "模拟密码找回尚未启用" })
      .waitFor();
    assert.equal(await anonymous.getByRole("status").count(), 0);
    await anonymous.screenshot({
      path: `${dir}/after-forgot-unavailable.png`,
      animations: "disabled",
    });
    await anonymous.goto("http://127.0.0.1:5175/#register");
    await anonymous.getByRole("heading", { name: "注册爱管理账号" }).waitFor();
    const metrics = await anonymous.evaluate(() => ({
      width: document.querySelector(".login-main").getBoundingClientRect()
        .width,
      formHeight: document.querySelector("input").getBoundingClientRect()
        .height,
      brandWidth: document.querySelector(".brand-side").getBoundingClientRect()
        .width,
    }));
    assert.equal(Math.round(metrics.width), 424);
    assert.equal(Math.round(metrics.formHeight), 45);
    assert.equal(Math.round(metrics.brandWidth), 806);
    await anonymous.setViewportSize({ width: 390, height: 844 });
    await anonymous.screenshot({
      path: `${dir}/after-register-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    assert.equal(await anonymous.locator(".brand-side").isVisible(), false);
    assert.equal(
      await anonymous.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    pass(
      "Disabled simulation explicitly fails, desktop 56/44 layout and 424px form match the prototype, mobile registration has no horizontal overflow",
    );
    const reference = resolve(".runtime/v43-auth-reference.html");
    if (fs.existsSync(reference)) {
      const ref = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      ref.on("pageerror", (error) => errors.push(error.message));
      for (const mode of ["login", "register", "forgot", "reset"]) {
        await ref.goto(pathToFileURL(reference).href + "#" + mode);
        await ref.locator("#view-" + mode).waitFor({ state: "visible" });
        await ref.screenshot({
          path: `${dir}/reference-${mode}.png`,
          animations: "disabled",
        });
      }
      pass(
        "Four approved embedded prototype screens captured at the same 1440×900 viewport",
      );
    }
    assert.deepEqual(errors, []);
    pass("Zero browser runtime errors");
    fs.writeFileSync(
      `${dir}/result.json`,
      JSON.stringify(
        {
          result: "PASS",
          viewport: { width: 1440, height: 900 },
          checks,
          pageErrors: errors,
          pending: [],
        },
        null,
        2,
      ),
    );
  } finally {
    if (oldSession) await oldSession.dispose();
    if (browser) await browser.close();
    if (vite) await vite.close();
    if (app) await app.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
