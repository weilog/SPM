const fs = require("fs"),
  { resolve } = require("path"),
  { pathToFileURL } = require("url"),
  { chromium } = require("playwright");
(async () => {
  const dir = ".runtime/a-audit";
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({
    executablePath:
      process.env.SPM_CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    for (const id of ["A01", "A02", "A03", "A04", "A05", "A06"]) {
      await p.goto(
        pathToFileURL(resolve(".runtime/a-reference/" + id + ".html")).href,
      );
      await p.screenshot({
        path: `${dir}/reference-${id}.png`,
        animations: "disabled",
      });
      if (id === "A02") {
        await p.locator(".page-title .primary").click();
        await p.screenshot({
          path: `${dir}/reference-A02-editor.png`,
          animations: "disabled",
        });
      }
      if (id === "A05") {
        await p.locator('[data-open="d3"]').click();
        await p.screenshot({
          path: `${dir}/reference-A05-preview.png`,
          animations: "disabled",
        });
      }
      if (id === "A06") {
        await p.locator('[data-action="detail"]').first().click();
        await p.screenshot({
          path: `${dir}/reference-A06-detail.png`,
          animations: "disabled",
        });
      }
      if (id === "A04") {
        fs.writeFileSync(
          "scripts/fixtures/a-plans-v32.json",
          JSON.stringify(await p.evaluate(() => plans), null, 2),
        );
        for (const view of ["list", "kanban", "gantt", "members"]) {
          await p.locator(`[data-view="${view}"]`).click();
          await p.screenshot({
            path: `${dir}/reference-A04-${view}.png`,
            animations: "disabled",
          });
        }
        await p.evaluate(() => openModal("item"));
        await p.screenshot({
          path: `${dir}/reference-A04-editor.png`,
          animations: "disabled",
        });
      }
    }
    fs.writeFileSync(
      `${dir}/reference-result.json`,
      JSON.stringify(
        { viewport: { width: 1440, height: 900 }, errors },
        null,
        2,
      ),
    );
    console.log({ captured: 14, errors });
    if (errors.length) process.exitCode = 1;
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
