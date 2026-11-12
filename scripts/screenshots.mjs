// Screenshot pages of a running site at desktop and phone width, and report console errors,
// broken images and horizontal overflow. Used for visual checks after template changes.
//
//   node scripts/screenshots.mjs http://127.0.0.1:8099 out-dir [/path ...]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [base = "http://127.0.0.1:8080", outDir = "screenshots", ...paths] = process.argv.slice(2);
const pages = paths.length
  ? paths
  : ["/", "/over-rit/", "/studentenprojecten/", "/onderzoeksprojecten/", "/projecten/check-out/",
     "/projecten/generatieve-ai-provincie-noord-holland/", "/projecten/p5-banners-voor-de-rit-website/",
     "/nieuws/", "/nieuws/2026-11-05-nieuwe-website/", "/agenda/", "/agenda/lectorale-rede-pascal-wiggers/",
     "/mensen/", "/mensen/sophie-horsman/", "/partners/", "/404.html"];
const viewports = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } };

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
let problems = 0;
for (const [label, viewport] of Object.entries(viewports)) {
  const context = await browser.newContext({ viewport });
  for (const p of pages) {
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + p, { waitUntil: "networkidle" });
    // load lazy images
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 40)); }
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForLoadState("networkidle");
    const broken = await page.evaluate(() =>
      [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.currentSrc || img.src));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = (p.replace(/\//g, "_").replace(/^_|_$/g, "") || "home") + `.${label}.png`;
    await page.screenshot({ path: path.join(outDir, name.replace(".png", ".top.png")) });
    await page.screenshot({ path: path.join(outDir, name), fullPage: true });
    const issues = [...errors.map((e) => `console: ${e}`), ...broken.map((b) => `broken image: ${b}`),
      ...(overflow > 1 ? [`horizontal overflow: ${overflow}px`] : [])];
    problems += issues.length;
    console.log(`${issues.length ? "✗" : "✓"} ${label} ${p}${issues.map((i) => `\n    ${i}`).join("")}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
process.exit(problems ? 1 : 0);
