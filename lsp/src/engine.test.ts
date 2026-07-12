import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

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

  it("populates the curated ARGS_CHAINS", () => {
    assertEquals(
      index.api.get("args")?.map((e) => e.label),
      ["state", "inputs", "outputs", "audio", "gtk", "grid", "geometry"],
    );
    assert(
      index.api.get("args.inputs.keyboard")?.some((e) =>
        e.label === "key_down"
      ),
    );
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
