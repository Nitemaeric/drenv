import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { basename, fromFileUrl, join } from "@std/path";

import { Ruby } from "./ruby.ts";
import { EngineIndex } from "./engine.ts";
import type { ApiEntry } from "./types.ts";

const GEOMETRY_RB = `module Geometry
  # Returns the intersection of two rects.
  # @param rect_one [Hash] the first rect
  def intersect_rect?(rect_one, rect_two, tolerance = 0.1)
    rect_one.x
    rect_one.y
    rect_one.w
    rect_one.h
    rect_two.x
  end

  def _private_helper(a)
    a.x
  end

  def anchor_rect(rect, anchor_x:, anchor_y: 0.5)
    rect.x
  end
end
`;

const GEOMETRY_MD = `# Geometry

## \`intersect_rect?\`

Returns the intersection of two rects, or \`nil\`.
`;

const ARRAY_MD = `# Array

## \`each_with_index\`

Iterates with the index.

## \`Array\` Class Methods

Faster class-level variants:

- \`map\`
- \`select\`
`;

const ARGS_RB = `module GTK
  class Args
    attr_accessor :inputs
    attr_accessor :outputs
    attr_accessor :state
    attr_accessor :runtime
    alias_method :gtk, :runtime
  end
end
`;

const INPUTS_MD = `# Inputs (\`args.inputs\`)

## \`up\`

Returns whether up is pressed.

## Mouse (\`args.inputs.mouse\`)

### \`x\`

The mouse x coordinate.

### \`click\` OR \`down\`

Whether the mouse was clicked.

## Keyboard (\`args.inputs.keyboard\`)

### \`key_down\`

Keys pressed this frame.

## Controller (\`args.inputs.controller_(one-four)\`)

### \`connected\`

Whether the controller is connected.
`;

const OUTPUTS_MD = `# Outputs (\`args.outputs\`)

## \`sprites\`

Draw sprites this frame.

## \`background_color\`

Set the background color.
`;

const entry = (index: EngineIndex, cls: string, label: string): ApiEntry => {
  const found = index.api.get(cls)?.find((e) => e.label === label);
  assert(found, `expected ${cls} entry ${label}`);
  return found;
};

let ruby: Ruby;
let root: string;
let index: EngineIndex;

beforeAll(async () => {
  ruby = await Ruby.init();
  root = await Deno.makeTempDir({ prefix: "drenv-engine-" });
  const dir = join(root, "7.11");
  await ensureDir(join(dir, "docs", "oss", "dragon"));
  await ensureDir(join(dir, "docs", "api"));
  await Deno.writeTextFile(
    join(dir, "docs", "oss", "dragon", "geometry.rb"),
    GEOMETRY_RB,
  );
  await Deno.writeTextFile(
    join(dir, "docs", "api", "geometry.md"),
    GEOMETRY_MD,
  );
  await Deno.writeTextFile(join(dir, "docs", "api", "array.md"), ARRAY_MD);
  await Deno.writeTextFile(
    join(dir, "docs", "oss", "dragon", "args.rb"),
    ARGS_RB,
  );
  await Deno.writeTextFile(join(dir, "docs", "api", "inputs.md"), INPUTS_MD);
  await Deno.writeTextFile(join(dir, "docs", "api", "outputs.md"), OUTPUTS_MD);
  index = await EngineIndex.build(ruby, dir);
});

afterAll(async () => {
  await Deno.remove(root, { recursive: true });
});

describe("EngineIndex.build with a synthesized engine dir", () => {
  it("labels the index from the engine directory name", () => {
    assertEquals(index.label, "7.11");
  });

  it("parses engine methods, skipping underscore-prefixed ones", () => {
    const labels = index.api.get("Geometry")?.map((e) => e.label) ?? [];
    assert(labels.includes("intersect_rect?"));
    assert(labels.includes("anchor_rect"));
    assert(!labels.includes("_private_helper"));
  });

  it("classifies parameters and renders a signature", () => {
    const intersect = entry(index, "Geometry", "intersect_rect?");
    assertEquals(
      intersect.signature,
      "intersect_rect?(rect_one, rect_two, tolerance = 0.1)",
    );
    assertEquals(
      intersect.params?.map((p) => [p.name, p.kind]),
      [
        ["rect_one", "required"],
        ["rect_two", "required"],
        ["tolerance", "optional"],
      ],
    );

    const anchor = entry(index, "Geometry", "anchor_rect");
    assertEquals(
      anchor.params?.map((p) => [p.name, p.kind]),
      [
        ["rect", "required"],
        ["anchor_x", "keyword"],
        ["anchor_y", "keyword_optional"],
      ],
    );
  });

  it("derives duck shapes from geometric attr reads in the body", () => {
    const intersect = entry(index, "Geometry", "intersect_rect?");
    assertEquals(intersect.params?.[0].shape, ["h", "w", "x", "y"]);
    assertEquals(intersect.params?.[1].shape, ["x"]);
    assertEquals(intersect.params?.[2].shape, undefined);
  });

  it("enriches an engine method's doc from the markdown docs", () => {
    const intersect = entry(index, "Geometry", "intersect_rect?");
    assertEquals(
      intersect.doc,
      "Returns the intersection of two rects, or `nil`.",
    );
  });

  it("indexes markdown method docs via methodDocs", () => {
    const arrayDocs = index.methodDocs("Array");
    assertEquals(arrayDocs?.get("each_with_index"), "Iterates with the index.");
  });

  it("surfaces Array class-level variants and doc-only methods", () => {
    const map = entry(index, "Array", "map");
    assert(map.doc.includes("Class-level variant"));
    assert(map.doc.includes("Array.map(collection"));
    // A doc-only instance method (no bullet) is still surfaced.
    const eachWithIndex = entry(index, "Array", "each_with_index");
    assertEquals(eachWithIndex.doc, "Iterates with the index.");
  });

  it("derives the args.* chain tree from md annotations and args.rb", () => {
    // `args.` members: md H1 roots (inputs, outputs, state) unioned with the
    // GTK::Args accessors (runtime) and alias targets (gtk).
    const argMembers = index.api.get("args")?.map((e) => e.label) ?? [];
    for (const m of ["inputs", "outputs", "state", "runtime", "gtk"]) {
      assert(argMembers.includes(m), `args. missing ${m}`);
    }

    // Nested chains keyed separately; members from backticked headings.
    assert(
      index.api.get("args.inputs")?.some((e) => e.label === "up"),
    );
    for (const leaf of ["mouse", "keyboard", "controller_one"]) {
      assert(
        index.api.get("args.inputs")?.some((e) => e.label === leaf),
        `args.inputs missing leaf ${leaf}`,
      );
    }
    assert(index.api.get("args.inputs.mouse")?.some((e) => e.label === "x"));
    // Multi-token heading split on OR.
    assert(
      index.api.get("args.inputs.mouse")?.some((e) => e.label === "click"),
    );
    assert(index.api.get("args.inputs.mouse")?.some((e) => e.label === "down"));
    assert(
      index.api.get("args.inputs.keyboard")?.some((e) =>
        e.label === "key_down"
      ),
    );

    // controller_(one-four) expands to four chains, each carrying the members.
    for (const n of ["one", "two", "three", "four"]) {
      assert(
        index.api.get(`args.inputs.controller_${n}`)?.some((e) =>
          e.label === "connected"
        ),
        `controller_${n} missing connected`,
      );
    }

    assert(index.api.get("args.outputs")?.some((e) => e.label === "sprites"));
    assert(
      index.api.get("args.outputs")?.some((e) =>
        e.label === "background_color"
      ),
    );

    // args.state appears as an `args.` member but exposes no static sub-members
    // (runtime/user-defined — P5): no chain entry is emitted for it.
    assert(argMembers.includes("state"));
    assertEquals(index.api.has("args.state"), false);
  });

  it("attaches member prose docs (not just the generic fallback)", () => {
    const up = index.api.get("args.inputs")?.find((e) => e.label === "up");
    assertEquals(up?.doc, "Returns whether up is pressed.");
    // A leaf with no prose under it falls back to the generic label.
    const sprites = index.api.get("args.outputs")?.find((e) =>
      e.label === "sprites"
    );
    assertEquals(sprites?.doc, "Draw sprites this frame.");
  });

  it("exposes the validity receivers", () => {
    assertEquals([...index.validityReceivers].sort(), ["Easing", "Geometry"]);
  });
});

describe("EngineIndex version-independent tables", () => {
  it("returns curated core methods", () => {
    assert(index.coreMethods("Array")?.includes("map"));
    assert(index.coreMethods("Hash")?.includes("keys"));
    assertEquals(index.coreMethods("Nope"), undefined);
  });

  it("names the class of a literal receiver", () => {
    assertEquals(index.literalClass("[1, 2]."), "Array");
    assertEquals(index.literalClass('"hi".'), "String");
    assertEquals(index.literalClass("{}."), "Hash");
    assertEquals(index.literalClass("42."), "Numeric");
    assertEquals(index.literalClass("foo."), null);
  });
});

describe("EngineIndex with no engine (null path)", () => {
  it("degrades to an empty 'unknown' index that still serves core tables", async () => {
    const empty = await EngineIndex.build(ruby, join(root, "does-not-exist"));
    assertEquals(empty.label, "unknown");
    assertEquals(empty.api.size, 0);
    assertEquals(empty.methodDocs("Array"), undefined);
    // Version-independent tables keep working with no engine.
    assert(empty.coreMethods("Array")?.includes("map"));
    assertEquals(empty.literalClass('["a"].'), "Array");
    assertEquals([...empty.validityReceivers].sort(), ["Easing", "Geometry"]);
  });
});

describe("EngineIndex cache", () => {
  let denoJson: { version: string };

  const makeFixture = async (): Promise<string> => {
    const base = await Deno.makeTempDir({ prefix: "drenv-engine-cache-" });
    const dir = join(base, "9.42");
    await ensureDir(join(dir, "docs", "oss", "dragon"));
    await ensureDir(join(dir, "docs", "api"));
    await Deno.writeTextFile(
      join(dir, "docs", "oss", "dragon", "geometry.rb"),
      GEOMETRY_RB,
    );
    await Deno.writeTextFile(
      join(dir, "docs", "api", "geometry.md"),
      GEOMETRY_MD,
    );
    await Deno.writeTextFile(join(dir, "docs", "api", "array.md"), ARRAY_MD);
    return dir;
  };

  const cacheFile = (cacheDir: string, dir: string): string =>
    join(cacheDir, `${basename(dir)}.json`);

  beforeAll(async () => {
    denoJson = JSON.parse(
      await Deno.readTextFile(
        fromFileUrl(new URL("../../deno.json", import.meta.url)),
      ),
    );
  });

  it("serves stale-but-cached data on the second build", async () => {
    const dir = await makeFixture();
    const cacheDir = await Deno.makeTempDir({ prefix: "drenv-cache-" });

    const first = await EngineIndex.build(ruby, { rootDir: dir, cacheDir });
    assert(first.api.get("Geometry")?.some((e) => e.label === "anchor_rect"));

    // Mutate the fixture so a fresh parse would differ from the cache.
    await Deno.writeTextFile(
      join(dir, "docs", "oss", "dragon", "geometry.rb"),
      `module Geometry\n  def only_this(a)\n    a.x\n  end\nend\n`,
    );

    const second = await EngineIndex.build(ruby, { rootDir: dir, cacheDir });
    // The cache is served: the removed method is still present, the new one absent.
    assert(second.api.get("Geometry")?.some((e) => e.label === "anchor_rect"));
    assert(!second.api.get("Geometry")?.some((e) => e.label === "only_this"));

    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cacheDir, { recursive: true });
  });

  it("preserves params, shapes, signatures and method docs across the cache", async () => {
    const dir = await makeFixture();
    const cacheDir = await Deno.makeTempDir({ prefix: "drenv-cache-" });

    await EngineIndex.build(ruby, { rootDir: dir, cacheDir });
    // Gut the sources so a fresh parse could not reproduce the rich fields;
    // only the cache can supply them on the second build.
    await Deno.writeTextFile(
      join(dir, "docs", "oss", "dragon", "geometry.rb"),
      `module Geometry\nend\n`,
    );
    await Deno.writeTextFile(
      join(dir, "docs", "api", "geometry.md"),
      "# Geometry\n",
    );
    await Deno.writeTextFile(join(dir, "docs", "api", "array.md"), "# Array\n");

    const cached = await EngineIndex.build(ruby, { rootDir: dir, cacheDir });
    const intersect = entry(cached, "Geometry", "intersect_rect?");
    assertEquals(
      intersect.signature,
      "intersect_rect?(rect_one, rect_two, tolerance = 0.1)",
    );
    assertEquals(intersect.params?.[0].shape, ["h", "w", "x", "y"]);
    assertEquals(
      intersect.doc,
      "Returns the intersection of two rects, or `nil`.",
    );
    assertEquals(
      cached.methodDocs("Array")?.get("each_with_index"),
      "Iterates with the index.",
    );
    assert(entry(cached, "Array", "map").doc.includes("Class-level variant"));

    await Deno.remove(cacheDir, { recursive: true });
  });

  it("invalidates and reparses on a drenv version bump", async () => {
    const dir = await makeFixture();
    const cacheDir = await Deno.makeTempDir({ prefix: "drenv-cache-" });

    await EngineIndex.build(ruby, { rootDir: dir, cacheDir });

    // Rewrite the cache with a stale drenvVersion and a sentinel that a fresh
    // parse could never produce.
    const path = cacheFile(cacheDir, dir);
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        drenvVersion: "0.0.0-stale",
        engineVersion: basename(dir),
        api: [["Geometry", [{ label: "sentinel_stale", doc: "x" }]]],
        methodDocs: [],
      }),
    );

    const rebuilt = await EngineIndex.build(ruby, { rootDir: dir, cacheDir });
    assert(
      !rebuilt.api.get("Geometry")?.some((e) => e.label === "sentinel_stale"),
    );
    assert(
      rebuilt.api.get("Geometry")?.some((e) => e.label === "intersect_rect?"),
    );

    // The stale cache was rewritten with the current version.
    const after = JSON.parse(await Deno.readTextFile(path));
    assertEquals(after.drenvVersion, denoJson.version);

    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cacheDir, { recursive: true });
  });

  it("invalidates a stale cache SHAPE at an unchanged drenv version", async () => {
    const dir = await makeFixture();
    const cacheDir = await Deno.makeTempDir({ prefix: "drenv-cache-" });

    // A cache from an OLDER schema (shape 1: the spike's, no schemaVersion) but
    // the CURRENT drenv/engine version — the version checks alone would serve
    // it; the schema guard must still reject and reparse.
    const path = cacheFile(cacheDir, dir);
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        drenvVersion: denoJson.version,
        engineVersion: basename(dir),
        api: [["Geometry", [{ label: "sentinel_shape1", doc: "x" }]]],
        methodDocs: [],
      }),
    );

    const rebuilt = await EngineIndex.build(ruby, { rootDir: dir, cacheDir });
    assert(
      !rebuilt.api.get("Geometry")?.some((e) => e.label === "sentinel_shape1"),
      "stale shape-1 cache should have been rejected",
    );
    assert(
      rebuilt.api.get("Geometry")?.some((e) => e.label === "intersect_rect?"),
    );
    const after = JSON.parse(await Deno.readTextFile(path));
    assertEquals(after.schemaVersion, 2);

    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cacheDir, { recursive: true });
  });

  it("falls back cleanly when the cached JSON is corrupt", async () => {
    const dir = await makeFixture();
    const cacheDir = await Deno.makeTempDir({ prefix: "drenv-cache-" });
    await ensureDir(cacheDir);

    await Deno.writeTextFile(cacheFile(cacheDir, dir), "{ not valid json ]");

    const rebuilt = await EngineIndex.build(ruby, { rootDir: dir, cacheDir });
    assert(
      rebuilt.api.get("Geometry")?.some((e) => e.label === "intersect_rect?"),
    );

    // A valid cache was written over the corrupt file.
    const after = JSON.parse(await Deno.readTextFile(cacheFile(cacheDir, dir)));
    assertEquals(after.engineVersion, basename(dir));

    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cacheDir, { recursive: true });
  });

  it("skips the cache when only rootDir overrides (no cacheDir)", async () => {
    const dir = await makeFixture();
    const first = await EngineIndex.build(ruby, dir);
    assert(first.api.get("Geometry")?.some((e) => e.label === "anchor_rect"));

    // With no cacheDir the parse path is always taken: a mutation is reflected.
    await Deno.writeTextFile(
      join(dir, "docs", "oss", "dragon", "geometry.rb"),
      `module Geometry\n  def fresh_only(a)\n    a.x\n  end\nend\n`,
    );
    const second = await EngineIndex.build(ruby, dir);
    assert(second.api.get("Geometry")?.some((e) => e.label === "fresh_only"));
    assert(!second.api.get("Geometry")?.some((e) => e.label === "anchor_rect"));

    await Deno.remove(dir, { recursive: true });
  });
});
