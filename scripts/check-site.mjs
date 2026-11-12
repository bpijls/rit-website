// After the build: every internal link, image and script in _site/ must point at a file that exists.
//   node scripts/check-site.mjs [_site]
import fs from "node:fs";
import path from "node:path";

const site = path.resolve(process.argv[2] ?? "_site");
const htmlFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".html")) htmlFiles.push(full);
  }
};
walk(site);

const exists = (url) => {
  const clean = decodeURI(url.split(/[?#]/)[0]);
  const target = path.join(site, clean);
  if (clean.endsWith("/")) return fs.existsSync(path.join(target, "index.html"));
  return fs.existsSync(target) || fs.existsSync(path.join(target, "index.html"));
};

let problems = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const pageUrl = "/" + path.relative(site, path.dirname(file)).split(path.sep).join("/") + "/";
  const refs = [
    ...html.matchAll(/\s(?:href|src)="([^"]+)"/g),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((part) => [null, part.trim().split(/\s+/)[0]])),
  ].map((m) => m[1]);
  for (const ref of refs) {
    if (!ref || /^(https?:|mailto:|tel:|#|data:|javascript:)/.test(ref) || ref.startsWith("//")) continue;
    const url = ref.startsWith("/") ? ref : new URL(ref, `http://x${pageUrl}`).pathname;
    if (!exists(url)) {
      problems++;
      console.log(`✗ ${path.relative(site, file)}: ${ref} bestaat niet`);
    }
  }
}
console.log(`${htmlFiles.length} pagina's gecontroleerd, ${problems} kapotte link(s).`);
process.exit(problems ? 1 : 0);
