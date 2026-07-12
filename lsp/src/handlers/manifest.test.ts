import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

import { manifestCompletion, manifestDiagnostics } from "./manifest.ts";

type Diag = {
  range: { start: { line: number } };
  severity: number;
  message: string;
};
type Item = { label: string; kind: number };

const diags = (text: string) => manifestDiagnostics(text) as Diag[];
const labels = (items: unknown[]) => (items as Item[]).map((i) => i.label);

describe("manifestDiagnostics", () => {
  it("passes a valid manifest with no diagnostics", () => {
    const text = [
      "[package]",
      'root = "lib"',
      'entrypoint = "conjuration.rb"',
      'include = ["sprites"]',
      "",
      "[dependencies.draco]",
      'github = "guitsaru/draco"',
      'tag = "v0.7.0"',
      'entrypoint = "draco.rb"',
      "",
      "[dependencies.local]",
      'path = "../local"',
      "",
    ].join("\n");
    assertEquals(diags(text), []);
  });

  it("flags an unknown top-level key", () => {
    const out = diags('name = "x"\n');
    assertEquals(out.length, 1);
    assert(out[0].message.includes("not a known top-level key"));
    assertEquals(out[0].range.start.line, 0);
  });

  it("flags an unknown [package] key", () => {
    const out = diags('[package]\nroot = "lib"\nname = "x"\n');
    assertEquals(out.length, 1);
    assert(out[0].message.includes("not a known [package] key"));
    assertEquals(out[0].range.start.line, 2);
  });

  it("flags an unknown dependency key", () => {
    const out = diags('[dependencies.foo]\ngithub = "a/b"\nversion = "1"\n');
    assertEquals(out.length, 1);
    assert(out[0].message.includes("not a known dependency key"));
    assertEquals(out[0].range.start.line, 2);
  });

  it("flags a scalar key given the wrong type", () => {
    const out = diags("[package]\nroot = 123\n");
    assertEquals(out.length, 1);
    assertEquals(out[0].severity, 1);
    assert(out[0].message.includes("must be a string"));
    assertEquals(out[0].range.start.line, 1);
  });

  it("flags include when it is not an array of strings", () => {
    const out = diags('[package]\ninclude = "sprites"\n');
    assertEquals(out.length, 1);
    assert(out[0].message.includes("must be an array of strings"));
  });

  it("reuses the repo source rule for a dependency with no source", () => {
    const out = diags('[dependencies.foo]\nentrypoint = "foo.rb"\n');
    assertEquals(out.length, 1);
    assert(out[0].message.includes("must declare one of"));
    assertEquals(out[0].range.start.line, 0);
  });

  it("reuses the repo source rule for multiple sources", () => {
    const out = diags('[dependencies.foo]\ngithub = "a/b"\npath = "../x"\n');
    assertEquals(out.length, 1);
    assert(out[0].message.includes("multiple sources"));
  });

  it("reports malformed TOML as a positioned syntax error", () => {
    const out = diags("[package\nroot = 1\n");
    assertEquals(out.length, 1);
    assertEquals(out[0].severity, 1);
    assertEquals(out[0].range.start.line, 0);
  });

  it("maps a syntax error on a later line to that line", () => {
    const out = diags('[package]\nroot = "ok"\nbroken = = =\n');
    assertEquals(out.length, 1);
    assertEquals(out[0].range.start.line, 2);
  });

  it("does not warn on a bare [dependencies] table with inline specs", () => {
    const out = diags('[dependencies]\nfoo = { github = "a/b" }\n');
    assertEquals(out, []);
  });
});

describe("manifestCompletion", () => {
  it("completes section names at a table header", () => {
    const items = manifestCompletion("[", { line: 0, character: 1 });
    const l = labels(items);
    assert(l.includes("package"));
    assert(l.includes("dependencies"));
  });

  it("completes [package] keys inside the package table", () => {
    const text = "[package]\n\n";
    const items = manifestCompletion(text, { line: 1, character: 0 });
    const l = labels(items);
    assert(l.includes("root"));
    assert(l.includes("entrypoint"));
    assert(l.includes("include"));
  });

  it("completes dependency keys inside a dependency table", () => {
    const text = "[dependencies.foo]\n\n";
    const items = manifestCompletion(text, { line: 1, character: 0 });
    const l = labels(items);
    assert(l.includes("github"));
    assert(l.includes("path"));
    assert(l.includes("tag"));
    assert(l.includes("branch"));
    assert(l.includes("ref"));
    assert(l.includes("entrypoint"));
  });

  it("offers nothing outside any section", () => {
    assertEquals(manifestCompletion("\n", { line: 0, character: 0 }), []);
  });

  it("offers nothing for a bare [dependencies] table", () => {
    const text = "[dependencies]\n\n";
    assertEquals(manifestCompletion(text, { line: 1, character: 0 }), []);
  });
});
