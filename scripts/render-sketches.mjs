// Render every p5 sketch under content/ to a PNG, once.
//
// Sketches are static (noLoop + randomSeed), so one frame is the whole picture. The site never runs
// p5: it shows these PNGs (made responsive by eleventy-img) and links to sketch.js for download.
//
// Cache key = sha256(sketch source + p5 version + this script's RENDER_VERSION). A sketch that has
// been rendered before is skipped; .cache/sketches/manifest.json maps sketch path → PNG.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { CONTENT, ROOT, SKETCH_CACHE, SKETCH_MANIFEST, findSketchFiles } from "../src/lib/content.js";

const RENDER_VERSION = "1"; // bump to force a re-render of everything
const TIMEOUT_MS = 30_000;
const P5 = path.join(ROOT, "vendor/p5.min.js");

const p5Source = fs.readFileSync(P5, "utf8");
const hashOf = (source) =>
  crypto.createHash("sha256").update(source).update(p5Source).update(RENDER_VERSION).digest("hex").slice(0, 16);

// Runs before the sketch: count completed draw() calls so we know when the canvas is final.
const BEFORE = `
window.__sketchError = null;
window.addEventListener("error", (e) => { window.__sketchError = String(e.message || e); });
`;
// Runs after the sketch, before p5 starts (p5 global mode reads window.setup/draw on init).
const WRAP = `
(() => {
  const draw = window.draw;
  window.__frames = 0;
  if (typeof draw === "function") {
    window.draw = function () { draw.apply(this, arguments); window.__frames++; };
  } else if (typeof window.setup === "function") {
    const setup = window.setup;
    window.setup = function () { setup.apply(this, arguments); window.__frames++; };
  }
})();
`;

async function render(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  try {
    await page.setContent("<!doctype html><html><head><style>body{margin:0}</style></head><body></body></html>");
    await page.addScriptTag({ content: BEFORE });
    await page.addScriptTag({ content: fs.readFileSync(file, "utf8") + "\n" + WRAP });
    await page.addScriptTag({ content: p5Source });
    await page.waitForFunction(() => window.__frames > 0 || window.__sketchError, null, { timeout: TIMEOUT_MS });
    const error = await page.evaluate(() => window.__sketchError);
    if (error) throw new Error(error);
    const dataUrl = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll("canvas")];
      const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return canvas ? canvas.toDataURL("image/png") : null;
    });
    if (!dataUrl) throw new Error("sketch did not create a canvas");
    return Buffer.from(dataUrl.split(",")[1], "base64");
  } finally {
    await page.close();
  }
}

/** Render what is missing from the cache and write the manifest. Throws if a sketch fails. */
export async function renderSketches({ log = console.log } = {}) {
  fs.mkdirSync(SKETCH_CACHE, { recursive: true });
  const files = findSketchFiles();
  const manifest = {};
  const todo = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const png = path.join(SKETCH_CACHE, `${hashOf(fs.readFileSync(file, "utf8"))}.png`);
    manifest[rel] = path.relative(ROOT, png).split(path.sep).join("/");
    if (!fs.existsSync(png)) todo.push({ file, rel, png });
  }

  if (todo.length) {
    const browser = await chromium.launch();
    const failures = [];
    try {
      for (const { file, rel, png } of todo) {
        const started = Date.now();
        try {
          fs.writeFileSync(png, await render(browser, file));
          log(`rendered ${rel} (${Date.now() - started} ms)`);
        } catch (err) {
          failures.push(`${rel}: ${err.message.split("\n")[0]}`);
        }
      }
    } finally {
      await browser.close();
    }
    if (failures.length) {
      throw new Error(`${failures.length} sketch(es) failed to render:\n  ${failures.join("\n  ")}`);
    }
  }

  fs.writeFileSync(SKETCH_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  log(`sketches: ${files.length} total, ${todo.length} rendered, ${files.length - todo.length} from cache`);
  if (!files.length) log(`no sketches found under ${path.relative(ROOT, CONTENT)}/`);
  return { total: files.length, rendered: todo.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  renderSketches().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
