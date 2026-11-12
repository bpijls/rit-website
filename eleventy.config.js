// Eleventy: content/ (markdown + frontmatter) + src/ (templates, CSS, JS) → _site/
import fs from "node:fs";
import path from "node:path";
import Image, { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
import yaml from "js-yaml";
import markdownIt from "markdown-it";
import {
  CACHE,
  CONTENT,
  cmsConfigYaml,
  describe,
  entryDir,
  permalinkFor,
  readManifest,
  resolveSketch,
  ROOT,
  selectOptions,
  sortYear,
} from "./src/lib/content.js";
import { renderSketches } from "./scripts/render-sketches.mjs";

const isServe = process.env.ELEVENTY_RUN_MODE === "serve";
const md = markdownIt({ html: true, linkify: true, typographer: true });

const IMAGE_DEFAULTS = {
  formats: ["webp", "auto"],
  outputDir: path.join(CACHE, "img"),
  urlPath: "/img/",
  sharpOptions: { animated: false },
};

function copyReferencedImages(output) {
  const source = path.join(CACHE, "img");
  const target = path.join(output, "img");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const used = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".html")) {
        for (const m of fs.readFileSync(full, "utf8").matchAll(/\/img\/([\w.-]+)/g)) used.add(m[1]);
      }
    }
  };
  walk(output);
  for (const name of used) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
  }
}

export default function (eleventyConfig) {
  eleventyConfig.addDataExtension("yml,yaml", (contents) => yaml.load(contents));

  // ---------- per-entry data: kind, layout, permalink, drafts ----------
  eleventyConfig.addGlobalData("layout", "dispatch.njk");
  eleventyConfig.addGlobalData("eleventyComputed", {
    kind: (data) => describe(data.page.inputPath)?.kind,
    slug: (data) => describe(data.page.inputPath)?.slug,
    permalink: (data) => {
      if (data.draft && !isServe) return false;
      return permalinkFor(data.page.inputPath);
    },
    sortYear: (data) => sortYear(data.school_year),
  });
  eleventyConfig.addGlobalData("options", () => selectOptions());
  eleventyConfig.addGlobalData("build", () => ({ isServe, year: new Date().getFullYear() }));

  // ---------- collections (drafts only visible in the dev server) ----------
  const published = (items) => items.filter((item) => isServe || !item.data.draft);
  const byFolder = (api, folder) =>
    published(api.getFilteredByGlob(`content/${folder}/*/index.md`));

  eleventyConfig.addCollection("projects", (api) =>
    byFolder(api, "projecten").sort(
      (a, b) => (b.data.sortYear ?? 0) - (a.data.sortYear ?? 0) || a.data.title.localeCompare(b.data.title, "nl"),
    ),
  );
  eleventyConfig.addCollection("news", (api) =>
    byFolder(api, "nieuws").sort((a, b) => new Date(b.data.date) - new Date(a.data.date)),
  );
  eleventyConfig.addCollection("events", (api) =>
    byFolder(api, "agenda").sort((a, b) => new Date(a.data.start) - new Date(b.data.start)),
  );
  eleventyConfig.addCollection("people", (api) =>
    byFolder(api, "mensen").sort(
      (a, b) => (a.data.order ?? 999) - (b.data.order ?? 999) || a.data.name.localeCompare(b.data.name, "nl"),
    ),
  );
  eleventyConfig.addCollection("partners", (api) =>
    byFolder(api, "partners").sort((a, b) => a.data.name.localeCompare(b.data.name, "nl")),
  );
  eleventyConfig.addCollection("sketchLibrary", (api) => api.getFilteredByGlob("content/sketches/*/index.md"));

  // ---------- filters ----------
  eleventyConfig.addFilter("md", (text) => (text ? md.render(String(text)) : ""));
  eleventyConfig.addFilter("mdInline", (text) => (text ? md.renderInline(String(text)) : ""));
  eleventyConfig.addFilter("bySlug", (items, slugs) =>
    (slugs ?? []).map((slug) => items.find((item) => item.data.slug === slug)).filter(Boolean),
  );
  eleventyConfig.addFilter("findSlug", (items, slug) => items.find((item) => item.data.slug === slug));
  eleventyConfig.addFilter("label", (value, field) => selectOptions()[field]?.[value] ?? value ?? "");

  eleventyConfig.addFilter("head", (items, n) => (items ?? []).slice(0, n));
  eleventyConfig.addFilter("initials", (name) =>
    String(name ?? "").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).slice(0, 2).join(""),
  );
  eleventyConfig.addFilter("usedValues", (items, field) =>
    [...new Set(items.map((item) => item.data[field]).filter(Boolean))].sort(),
  );
  eleventyConfig.addFilter("yearOptions", (projects) => {
    const years = new Map();
    for (const p of projects) if (p.data.sortYear) years.set(p.data.sortYear, p.data.school_year);
    return [...years].sort((a, b) => b[0] - a[0]).map(([value, label]) => ({ value, label }));
  });
  eleventyConfig.addFilter("withResearcher", (projects, slug) =>
    projects.filter((p) => (p.data.researchers ?? []).includes(slug)),
  );

  // project-cards section: featured | latest | manual, optionally filtered by type.
  eleventyConfig.addFilter("pickProjects", (projects, section) => {
    const type = section.project_type ?? "all";
    const ofType = projects.filter((p) => type === "all" || p.data.type === type);
    const limit = section.limit ?? 3;
    if (section.source === "manual") {
      return (section.projects ?? []).map((slug) => projects.find((p) => p.data.slug === slug)).filter(Boolean);
    }
    if (section.source === "featured") {
      const featured = ofType.filter((p) => p.data.featured);
      return (featured.length ? featured : ofType).slice(0, limit);
    }
    return ofType.slice(0, limit);
  });
  eleventyConfig.addFilter("ofType", (projects, type) =>
    !type || type === "all" ? projects : projects.filter((p) => p.data.type === type),
  );
  eleventyConfig.addFilter("relatedProjects", (projects, current) => {
    const picked = (current.data.related ?? []).length
      ? (current.data.related ?? []).map((slug) => projects.find((p) => p.data.slug === slug)).filter(Boolean)
      : projects.filter((p) => p.data.type === current.data.type);
    return picked.filter((p) => p.url !== current.url).slice(0, 3);
  });
  eleventyConfig.addFilter("eventsWhen", (events, when = "upcoming") => {
    const now = Date.now();
    const end = (e) => new Date(e.data.end ?? e.data.start).getTime();
    if (when === "past") return events.filter((e) => end(e) < now).reverse();
    if (when === "upcoming") return events.filter((e) => end(e) >= now);
    return events;
  });
  const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
  const timeFmt = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  eleventyConfig.addFilter("date", (value) => (value ? dateFmt.format(new Date(value)) : ""));
  eleventyConfig.addFilter("time", (value) => (value ? timeFmt.format(new Date(value)) : ""));
  eleventyConfig.addFilter("isoDate", (value) => (value ? new Date(value).toISOString() : ""));
  // YouTube watch/short links → embed links, so editors can paste whatever the browser shows.
  eleventyConfig.addFilter("embedUrl", (url) => {
    const yt = String(url).match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
    if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
    const vimeo = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
    return url;
  });

  // Entry-relative media path → path from content/ root ("/projecten/x/foto.jpg"), which the image
  // transform resolves against content/. External URLs and absolute paths pass through.
  eleventyConfig.addFilter("asset", (src, inputPath) => {
    if (!src || /^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
    const file = path.resolve(entryDir(inputPath), src);
    return "/" + path.relative(CONTENT, file).split(path.sep).join("/");
  });

  // ---------- sketches: library slug or entry file → rendered PNG ----------
  const sketchLibrary = (slug) => {
    const file = path.join(CONTENT, "sketches", slug ?? "", "index.md");
    if (!slug || !fs.existsSync(file)) return null;
    const alt = fs.readFileSync(file, "utf8").match(/^alt:\s*"?(.*?)"?\s*$/m)?.[1];
    return { alt };
  };
  /** { file, url, png, alt } for an entry's sketch, falling back to the site default. */
  eleventyConfig.addFilter("sketchFor", function (entry, fallbackSlug) {
    const data = entry?.data ?? entry ?? {};
    const inputPath = entry?.inputPath ?? entry?.page?.inputPath ?? this.page?.inputPath;
    let ref = resolveSketch({ sketch: data.sketch, sketch_file: data.sketch_file, inputPath });
    let slug = data.sketch_file ? null : data.sketch;
    if (!ref) {
      slug = fallbackSlug;
      ref = resolveSketch({ sketch: slug });
    }
    if (!ref) return null;
    const png = readManifest()[path.relative(ROOT, ref.file).split(path.sep).join("/")];
    const alt = data.sketch_alt ?? data.alt ?? sketchLibrary(slug)?.alt ?? "";
    return { ...ref, png: png && path.join(ROOT, png), alt };
  });

  eleventyConfig.addAsyncShortcode("sketchImage", async function (sketch, opts = {}) {
    if (!sketch?.png) {
      // Rendering failed or the file is missing; the validator reports why. Keep the dev server running.
      if (isServe) return `<span class="sketch-missing">Sketch nog niet gerenderd</span>`;
      throw new Error(`Sketch not rendered: ${sketch?.file}. Run npm run sketches.`);
    }
    // Sketches are opaque: JPEG is a much smaller fallback than PNG.
    const metadata = await Image(sketch.png, {
      ...IMAGE_DEFAULTS,
      formats: ["webp", "jpeg"],
      widths: opts.widths ?? [480, 960, 1920],
    });
    return Image.generateHTML(metadata, {
      alt: opts.decorative ? "" : sketch.alt,
      sizes: opts.sizes ?? "100vw",
      loading: opts.eager ? "eager" : "lazy",
      fetchpriority: opts.eager ? "high" : undefined,
      decoding: "async",
      class: opts.class,
      "eleventy:ignore": "",
    });
  });

  // ---------- images in content: <img> tags → responsive <picture> ----------
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    ...IMAGE_DEFAULTS,
    widths: [480, 960, 1600],
    failOnError: true,
    htmlOptions: { imgAttributes: { loading: "lazy", decoding: "async" } },
  });

  // ---------- static files ----------
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/admin/index.html": "admin/index.html" });
  // sketch.js files, for the "Download p5 code" links. Same path as in content/.
  eleventyConfig.addPassthroughCopy("content/**/*.js");
  eleventyConfig.setServerPassthroughCopyBehavior("passthrough");

  // Render new or changed sketches before each build (a no-op when everything is cached).
  eleventyConfig.on("eleventy.before", async () => {
    await renderSketches({ log: (msg) => console.log(`[sketches] ${msg}`) });
  });
  eleventyConfig.addWatchTarget("content/**/*.js");

  eleventyConfig.on("eleventy.after", ({ directories }) => {
    // Optimised images are generated into .cache/img (kept between CI runs). Copy only the ones the
    // pages reference, so images of removed content do not pile up in the site.
    copyReferencedImages(directories.output);
    // The CMS config Sveltia loads is generated from the schema.
    fs.mkdirSync(path.join(directories.output, "admin"), { recursive: true });
    fs.writeFileSync(path.join(directories.output, "admin/config.yml"), cmsConfigYaml());
  });
  eleventyConfig.addWatchTarget("src/admin/schema.yml");

  eleventyConfig.setLibrary("md", md);

  return {
    dir: { input: "content", includes: "../src/_includes", data: "_data", output: "_site" },
    templateFormats: ["md", "njk"],
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
}
