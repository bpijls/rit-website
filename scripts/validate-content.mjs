// Check every file in content/ against src/admin/schema.yml (the same schema the CMS forms use).
//
//   node scripts/validate-content.mjs            → exit 1 on errors, prints file: field — message
//   node scripts/validate-content.mjs some/dir   → validate another content root (used by the tests)
//
// Rules follow Decap/Sveltia: fields are required unless `required: false`. On top of the schema it checks
// that relations point at existing entries, that images/files/sketches exist, and that folder names are
// valid slugs. In GitHub Actions errors are also printed as annotations on the offending file.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { CONTENT, ROOT, loadCmsConfig } from "../src/lib/content.js";

const contentRoot = path.resolve(process.argv[2] ?? CONTENT);
const repoRoot = path.dirname(contentRoot);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const errors = [];
const warnings = [];
const rel = (file) => path.relative(process.cwd(), file);
const report = (list, file, field, message) => list.push({ file, field, message });

// ---------- reading ----------
function readEntry(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (file.endsWith(".yml") || file.endsWith(".yaml")) return { data: yaml.load(raw) ?? {}, body: "" };
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw, noFrontmatter: true };
  return { data: yaml.load(match[1]) ?? {}, body: match[2] };
}

function collectionEntries(collection) {
  const folder = path.join(repoRoot, collection.folder);
  if (!fs.existsSync(folder)) return [];
  const bundle = (collection.path ?? "").includes("/index");
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((d) => {
      if (bundle && d.isDirectory()) return [{ slug: d.name, file: path.join(folder, d.name, "index.md") }];
      if (!bundle && d.isFile() && d.name.endsWith(".md")) return [{ slug: d.name.replace(/\.md$/, ""), file: path.join(folder, d.name) }];
      return [];
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

// ---------- field checks ----------
const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const optionValues = (field) => field.options.map((o) => (typeof o === "object" ? o.value : o));

function checkField(field, value, ctx, where) {
  if (isEmpty(value)) {
    if (field.required !== false && field.widget !== "boolean" && field.widget !== "hidden") {
      report(errors, ctx.file, where, "is verplicht maar ontbreekt");
    }
    return;
  }
  const fail = (msg) => report(errors, ctx.file, where, msg);
  switch (field.widget ?? "string") {
    case "string":
    case "text":
    case "markdown":
      if (typeof value !== "string" && typeof value !== "number") return fail(`moet tekst zijn, niet ${typeof value}`);
      if (field.pattern) {
        const [re, msg] = field.pattern;
        if (!new RegExp(re).test(String(value))) fail(`${msg ?? `komt niet overeen met ${re}`} (nu: "${value}")`);
      }
      if (field.widget === "markdown") checkMarkdownImages(String(value), ctx, where);
      return;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) return fail(`moet een getal zijn (nu: "${value}")`);
      if (field.value_type === "int" && !Number.isInteger(value)) fail("moet een geheel getal zijn");
      if (field.min !== undefined && value < field.min) fail(`moet minstens ${field.min} zijn`);
      if (field.max !== undefined && value > field.max) fail(`mag hoogstens ${field.max} zijn`);
      return;
    case "boolean":
      if (typeof value !== "boolean") fail(`moet true of false zijn (nu: "${value}")`);
      return;
    case "datetime":
      if (!(value instanceof Date) && Number.isNaN(Date.parse(String(value)))) fail(`is geen geldige datum (nu: "${value}")`);
      return;
    case "select": {
      const allowed = optionValues(field);
      const values = field.multiple ? [].concat(value) : [value];
      for (const v of values) if (!allowed.includes(v)) fail(`"${v}" is geen geldige keuze; kies uit: ${allowed.join(", ")}`);
      return;
    }
    case "relation": {
      const values = field.multiple ? [].concat(value) : [value];
      if (!field.multiple && Array.isArray(value)) return fail("verwacht één waarde, geen lijst");
      for (const v of values) {
        if (!ctx.slugs[field.collection]?.has(String(v))) {
          fail(`verwijst naar "${v}", maar dat bestaat niet in ${field.collection}/`);
        }
      }
      return;
    }
    case "image":
    case "file": {
      if (typeof value !== "string") return fail("moet een bestandsnaam zijn");
      if (/^https?:\/\//.test(value)) return;
      const target = value.startsWith("/") ? path.join(contentRoot, value) : path.resolve(path.dirname(ctx.file), value);
      if (!fs.existsSync(target)) fail(`bestand "${value}" niet gevonden (gezocht: ${rel(target)})`);
      return;
    }
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) return fail("moet een groep velden zijn");
      checkFields(field.fields, value, ctx, where);
      return;
    case "list":
      if (!Array.isArray(value)) return fail("moet een lijst zijn");
      value.forEach((item, i) => {
        const at = `${where}[${i + 1}]`;
        if (field.types) {
          const typeKey = field.typeKey ?? "type";
          const type = field.types.find((t) => t.name === item?.[typeKey]);
          if (!type) {
            return report(errors, ctx.file, at, `onbekend type "${item?.[typeKey]}"; kies uit: ${field.types.map((t) => t.name).join(", ")}`);
          }
          const { [typeKey]: _, ...rest } = item;
          checkFields(type.fields, rest, ctx, `${at} (${type.name})`);
        } else if (field.fields) {
          if (typeof item !== "object" || item === null) return report(errors, ctx.file, at, "moet een groep velden zijn");
          checkFields(field.fields, item, ctx, at);
        } else if (field.field) {
          checkField(field.field, item, ctx, at);
        } else if (typeof item !== "string") {
          report(errors, ctx.file, at, "moet tekst zijn");
        }
      });
      return;
    default:
      return;
  }
}

function checkFields(fields, data, ctx, where = "") {
  const known = new Set(fields.map((f) => f.name));
  for (const field of fields) {
    if (field.name === "body" && field.widget === "markdown" && ctx.bodyIsContent && !where) continue;
    checkField(field, data[field.name], ctx, where ? `${where}.${field.name}` : field.name);
  }
  for (const key of Object.keys(data ?? {})) {
    if (!known.has(key)) report(errors, ctx.file, where ? `${where}.${key}` : key, "onbekend veld (typfout?)");
  }
}

// Relative images in markdown: ![alt](foto.jpg) must exist next to the entry and have alt text.
function checkMarkdownImages(text, ctx, where) {
  for (const [, alt, src] of text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) {
    if (!alt.trim()) report(errors, ctx.file, where, `afbeelding "${src}" heeft geen beschrijving: schrijf ![wat je ziet](${src})`);
    if (/^(https?:)?\/\//.test(src)) continue;
    const target = src.startsWith("/") ? path.join(contentRoot, src) : path.resolve(path.dirname(ctx.file), decodeURI(src));
    if (!fs.existsSync(target)) report(errors, ctx.file, where, `afbeelding "${src}" niet gevonden`);
  }
}

// ---------- extra rules per collection ----------
function extraRules(name, entry, data, ctx) {
  if (name === "projecten" && data.type === "student") {
    if (!data.programme) report(warnings, ctx.file, "programme", "studentenproject zonder opleiding: het filter 'opleiding' kan het niet vinden");
  }
  if (name === "projecten" && data.type === "research") {
    for (const key of ["programme", "level", "unit", "study_year", "student_count"]) {
      if (!isEmpty(data[key])) report(warnings, ctx.file, key, "wordt niet getoond bij een onderzoeksproject");
    }
  }
  if (data.sketch_file && !String(data.sketch_file).endsWith(".js")) {
    report(errors, ctx.file, "sketch_file", "moet een .js-bestand zijn");
  }
  if (name === "agenda" && data.end && data.start && new Date(data.end) < new Date(data.start)) {
    report(errors, ctx.file, "end", "ligt vóór het begin");
  }
}

// ---------- run ----------
function main() {
  const config = loadCmsConfig();
  const collections = config.collections;

  // slugs per folder collection, for relation checks
  const slugs = Object.fromEntries(
    collections.filter((c) => c.folder).map((c) => [c.name, new Set(collectionEntries(c).map((e) => e.slug))]),
  );
  let count = 0;

  for (const collection of collections) {
    if (collection.folder) {
      const bundle = (collection.path ?? "").includes("/index");
      const folder = path.join(repoRoot, collection.folder);
      for (const entry of collectionEntries(collection)) {
        const ctx = { file: entry.file, slugs, bodyIsContent: true };
        if (!SLUG.test(entry.slug)) {
          report(errors, entry.file, "(map- of bestandsnaam)", `"${entry.slug}" is geen geldige slug: gebruik kleine letters, cijfers en streepjes`);
        }
        if (bundle && !fs.existsSync(entry.file)) {
          report(errors, path.join(folder, entry.slug), "(map)", "map zonder index.md");
          continue;
        }
        const { data, body, noFrontmatter } = readEntry(entry.file);
        if (noFrontmatter) {
          report(errors, entry.file, "(frontmatter)", "het bestand moet beginnen met --- en de velden, en daarna weer ---");
          continue;
        }
        count++;
        checkFields(collection.fields, data, ctx);
        const bodyField = collection.fields.find((f) => f.name === "body" && f.widget === "markdown");
        if (bodyField && bodyField.required !== false && !body.trim()) report(errors, entry.file, "body", "tekst (onder de ---) is verplicht maar ontbreekt");
        checkMarkdownImages(body, ctx, "body");
        extraRules(collection.name, entry, data, ctx);
      }
    }
    for (const fileDef of collection.files ?? []) {
      const file = path.join(repoRoot, fileDef.file);
      if (!fs.existsSync(file)) {
        report(errors, file, "(bestand)", "ontbreekt");
        continue;
      }
      count++;
      checkFields(fileDef.fields, readEntry(file).data, { file, slugs, bodyIsContent: false });
    }
  }

  const gh = process.env.GITHUB_ACTIONS === "true";
  const print = (level, { file, field, message }) => {
    console.log(`${level === "error" ? "✗" : "!"} ${rel(file)}: ${field} — ${message}`);
    if (gh) console.log(`::${level} file=${path.relative(ROOT, file)},title=${field}::${message}`);
  };
  warnings.forEach((w) => print("warning", w));
  errors.forEach((e) => print("error", e));
  console.log(`\n${count} bestanden gecontroleerd: ${errors.length} fout(en), ${warnings.length} waarschuwing(en).`);
  process.exit(errors.length ? 1 : 0);
}

main();
