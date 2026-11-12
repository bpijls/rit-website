// The content validator: a valid fixture passes, a broken one fails with readable messages.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const run = (fixture) =>
  spawnSync(process.execPath, ["scripts/validate-content.mjs", `tests/fixtures/${fixture}/content`], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "" },
  });

test("valid content passes", () => {
  const result = run("valid");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 fout\(en\)/);
});

test("the real content passes", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-content.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("broken content fails with one message per problem", () => {
  const result = run("broken");
  assert.equal(result.status, 1);
  const expected = [
    /Bad_Name.*geen geldige slug/,
    /bad-project\/index\.md: title — is verplicht/,
    /school_year — Bijvoorbeeld 2025-2026/,
    /programme — "ict" is geen geldige keuze/,
    /partners — verwijst naar "onbekende-partner"/,
    /titel — onbekend veld/,
    /gallery\[1\]\.image — bestand "bestaat-niet\.jpg" niet gevonden/,
    /gallery\[1\]\.alt — is verplicht/,
    /afbeelding "ook-weg\.png" heeft geen beschrijving/,
    /sections\[1\] — onbekend type "carousel"/,
    /sections\[2\] \(video\)\.url — Gebruik een YouTube- of Vimeo-link/,
    /no-file\/index\.md: sketch_file — bestand "sketch\.js" niet gevonden/,
    /site\.yml: default_sketch — verwijst naar "does-not-exist"/,
    /site\.yml: nav — is verplicht/,
  ];
  for (const re of expected) assert.match(result.stdout, re);
  assert.match(result.stdout, /15 fout\(en\)/);
});

test("GitHub Actions gets file annotations", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-content.mjs", "tests/fixtures/broken/content"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "true" },
  });
  assert.match(result.stdout, /::error file=tests\/fixtures\/broken\/content\/projecten\/bad-project\/index\.md,title=title::/);
});
