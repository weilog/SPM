// Captures the supplied approved HTML only; never imports its sample data into the running app.
const fs = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const path = process.argv[2] || process.env.SPM_REFERENCE_HTML;
  if (!path)
    throw new Error(
      "Pass the V4.3 HTML path as the first argument or SPM_REFERENCE_HTML",
    );
  const dir = ".runtime/v43-audit";
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SPM_CHROME_PATH
      ? { executablePath: process.env.SPM_CHROME_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(resolve(path)).href);
    const nav = async (p) => {
      await page
        .locator("[data-field=role]")
        .selectOption(p === "mytasks" ? "member" : "manager");
      await page.locator(`[data-action=nav][data-page=${p}]`).first().click();
      await page.waitForTimeout(150);
    };
    const shot = async (name) =>
      page.screenshot({
        path: `${dir}/reference-${name}.png`,
        animations: "disabled",
      });
    for (const p of [
      "projects",
      "requirements",
      "tasks",
      "mytasks",
      "workspace",
      "plan",
    ]) {
      await nav(p);
      await shot(p);
      if (p === "requirements") {
        for (const tab of ["map", "board"]) {
          await page.locator(`[data-action=req-tab][data-tab=${tab}]`).click();
          await shot(tab);
        }
      }
    }
    await nav("tasks");
    await page.locator("[data-action=task-tab][data-tab=graph]").click();
    await shot("members");
    await nav("tasks");
    await page.locator("[data-action=task-tab][data-tab=list]").click();
    await page.locator('[data-action=task-more][data-id="T-002"]').click();
    await shot("task-menu");
    await page.locator("[data-action=task-progress-open]").click();
    await shot("task-drawer");
    await page.locator("[data-action=drawer-close]").last().click();
    await nav("workspace");
    await page.locator('[data-action=preset][data-preset="map,uml"]').click();
    await shot("workbench-dual");
    await page.locator("[data-action=mode][data-mode=single]").click();
    await page.locator("[data-action=primary][data-view=uml]").click();
    await shot("uml");
    console.log(
      JSON.stringify(
        { viewport: { width: 1440, height: 900 }, pageErrors: errors },
        null,
        2,
      ),
    );
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
