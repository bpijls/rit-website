// Shared knowledge about the content/ folder, used by eleventy.config.js and the scripts.
// Keep every "where does a file live / what URL does it get" rule here.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const CONTENT = path.join(ROOT, "content");
export const CACHE = path.join(ROOT, ".cache");
export const SKETCH_CACHE = path.join(CACHE, "sketches");
export const SKETCH_MANIFEST = path.join(SKETCH_CACHE, "manifest.json");
export const CMS_CONFIG = path.join(ROOT, "src/admin/schema.yml");

/**
 * Content kinds, keyed by top-level folder in content/.
 * `bundle`: one folder per entry (<slug>/index.md) with its media next to it.
 * `url`: public path prefix, or null when entries get no page of their own.
 */
export const KINDS = {
  pages: { kind: "page", bundle: false, url: "" },
  projecten: { kind: "project", bundle: true, url: "/projecten/" },
  nieuws: { kind: "news", bundle: true, url: "/nieuws/" },
  agenda: { kind: "event", bundle: true, url: "/agenda/" },
  mensen: { kind: "person", bundle: true, url: "/mensen/" },
  partners: { kind: "partner", bundle: true, url: null },
  sketches: { kind: "sketch", bundle: true, url: null },
};

/** "content/projecten/check-out/index.md" → { folder, kind, slug, ... } */
export function describe(inputPath) {
  const rel = path.relative(CONTENT, path.resolve(ROOT, inputPath)).split(path.sep);
  const info = KINDS[rel[0]];
  if (!info) return null;
  const slug = info.bundle ? rel[1] : path.basename(rel[1], ".md");
  return { folder: rel[0], slug, ...info };
}

export function permalinkFor(inputPath) {
  const d = describe(inputPath);
  if (!d) return undefined;
  if (d.kind === "page") return { home: "/", 404: "/404.html" }[d.slug] ?? `/${d.slug}/`;
  if (d.url === null) return false;
  return `${d.url}${d.slug}/`;
}

/** Directory a content entry's relative media paths resolve against. */
export const entryDir = (inputPath) => path.dirname(path.resolve(ROOT, inputPath));

/**
 * A sketch is referenced either by library slug (`sketch: favoriet-50`, content/sketches/<slug>/)
 * or by a file next to the entry (`sketch_file: sketch.js`). Returns absolute file + public URL.
 */
export function resolveSketch({ sketch, sketch_file, inputPath }) {
  if (sketch_file) {
    const file = path.resolve(entryDir(inputPath), sketch_file);
    const url = "/" + path.relative(CONTENT, file).split(path.sep).join("/");
    return { file, url };
  }
  if (sketch) {
    const file = path.join(CONTENT, "sketches", sketch, "sketch.js");
    return { file, url: `/sketches/${sketch}/sketch.js` };
  }
  return null;
}

/** Every sketch file under content/ (library and per-entry). */
export function findSketchFiles(dir = CONTENT) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSketchFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out.sort();
}

export function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(SKETCH_MANIFEST, "utf8"));
  } catch {
    return {};
  }
}

let cmsConfig;
/** The content schema (also the source of the Sveltia config). */
export function loadCmsConfig() {
  cmsConfig ??= yaml.load(fs.readFileSync(CMS_CONFIG, "utf8"));
  return cmsConfig;
}

/** Option lists of select widgets, by field name: { programme: { "hbo-ict": "HBO-ICT" }, ... } */
export function selectOptions() {
  const options = {};
  const visit = (fields = []) => {
    for (const f of fields) {
      if (f.widget === "select") {
        options[f.name] ??= {};
        for (const o of f.options) {
          const { label, value } = typeof o === "object" ? o : { label: o, value: o };
          options[f.name][value] = label;
        }
      }
      visit(f.fields);
      for (const t of f.types ?? []) visit(t.fields);
    }
  };
  for (const c of loadCmsConfig().collections) {
    visit(c.fields);
    for (const file of c.files ?? []) visit(file.fields);
  }
  return options;
}

/** "2024-2025" → 2025; "2025" → 2025; anything else → null. */
export function sortYear(schoolYear) {
  const years = String(schoolYear ?? "").match(/\d{4}/g);
  return years ? Math.max(...years.map(Number)) : null;
}

/** schema.yml → the plain config Sveltia loads: anchors/merges resolved, `x-` helper keys dropped. */
export function cmsConfigYaml() {
  const config = structuredClone(loadCmsConfig());
  for (const key of Object.keys(config)) if (key.startsWith("x-")) delete config[key];
  return (
    "# Generated from src/admin/schema.yml by the build. Do not edit.\n" +
    yaml.dump(config, { noRefs: true, lineWidth: 120 })
  );
}
