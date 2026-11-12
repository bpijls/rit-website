// Path and URL rules in src/lib/content.js.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { CONTENT, cmsConfigYaml, describe, permalinkFor, resolveSketch, selectOptions, sortYear } from "../src/lib/content.js";

test("permalinks per content kind", () => {
  assert.equal(permalinkFor("content/pages/home.md"), "/");
  assert.equal(permalinkFor("content/pages/404.md"), "/404.html");
  assert.equal(permalinkFor("content/pages/over-rit.md"), "/over-rit/");
  assert.equal(permalinkFor("content/projecten/check-out/index.md"), "/projecten/check-out/");
  assert.equal(permalinkFor("content/nieuws/2026-11-05-x/index.md"), "/nieuws/2026-11-05-x/");
  assert.equal(permalinkFor("content/partners/acme/index.md"), false);
  assert.equal(permalinkFor("content/sketches/x/index.md"), false);
});

test("describe() gives kind and slug", () => {
  assert.deepEqual(
    { kind: describe("content/projecten/check-out/index.md").kind, slug: describe("content/projecten/check-out/index.md").slug },
    { kind: "project", slug: "check-out" },
  );
  assert.equal(describe("content/elders/x.md"), null);
});

test("sortYear takes the last year of a school year", () => {
  assert.equal(sortYear("2024-2025"), 2025);
  assert.equal(sortYear("2024"), 2024);
  assert.equal(sortYear(2023), 2023);
  assert.equal(sortYear(undefined), null);
});

test("sketch references: library slug or file next to the entry", () => {
  assert.deepEqual(resolveSketch({ sketch: "abc" }), {
    file: path.join(CONTENT, "sketches/abc/sketch.js"),
    url: "/sketches/abc/sketch.js",
  });
  assert.deepEqual(resolveSketch({ sketch: "abc", sketch_file: "eigen.js", inputPath: "content/projecten/p/index.md" }), {
    file: path.join(CONTENT, "projecten/p/eigen.js"),
    url: "/projecten/p/eigen.js",
  });
  assert.equal(resolveSketch({}), null);
});

test("option labels come from the schema", () => {
  assert.equal(selectOptions().programme["hbo-ict"], "HBO-ICT");
  assert.equal(selectOptions().type.research, "Onderzoeksproject");
});

test("generated CMS config has no helper keys or anchors", () => {
  const out = cmsConfigYaml();
  assert.doesNotMatch(out, /^x-/m);
  assert.doesNotMatch(out, /[&*]\w+\s*$/m);
  assert.match(out, /publish_mode: editorial_workflow/);
});
