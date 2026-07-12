import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { Ruby } from "../ruby.ts";
import { Workspace } from "../workspace.ts";
import { Resolver } from "../resolve.ts";
import { YardRenderer } from "../yard.ts";
import { EngineIndex } from "../engine.ts";
import type { Ctx } from "./ctx.ts";
import { completion } from "./completion.ts";

const GEOMETRY_RB = `module Geometry
  # Returns the distance between two points.
  def distance point_one, point_two
    point_one.x
    point_one.y
    point_two.x
    point_two.y
  end

  # Rotates a point around another.
  def rotate_point point, angle, around = nil
    point.x
  end
end
`;

const ARRAY_MD = `# Array

## \`each_with_index\`

Iterates with the index.

## \`map_2d\`

A DragonRuby-specific Array extension that maps over a two-dimensional grid,
applying the block to every cell and returning a new grid of the same shape.

## \`Array\` Class Methods

Faster class-level variants that skip mutation checks:

- \`filter_map\`
- \`map\`
`;

const FIXTURE = `def tick args
  Geometry.
  args.
  [1, 2].
  Array.
  spawn
end

# Spawns enemies at a difficulty.
def spawn_enemy args
end
`;

const URI = "file:///test/main.rb";

// deno-lint-ignore no-explicit-any
const labelsOf = (items: unknown[]): string[] =>
  items.map((i) => (i as any).label);

let ruby: Ruby;
let root: string;
let ctx: Ctx;

beforeAll(async () => {
  ruby = await Ruby.init();
  root = await Deno.makeTempDir({ prefix: "drenv-completion-" });
  const dir = join(root, "7.11");
  await ensureDir(join(dir, "docs", "oss", "dragon"));
  await ensureDir(join(dir, "docs", "api"));
  await Deno.writeTextFile(
    join(dir, "docs", "oss", "dragon", "geometry.rb"),
    GEOMETRY_RB,
  );
  await Deno.writeTextFile(join(dir, "docs", "api", "array.md"), ARRAY_MD);

  const ws = new Workspace(ruby);
  const resolver = new Resolver(ws);
  const yard = new YardRenderer(resolver);
  const engine = await EngineIndex.build(ruby, dir);
  ctx = { ws, resolver, yard, engine };
  ws.indexFile(URI, FIXTURE);
});

afterAll(async () => {
  await Deno.remove(root, { recursive: true });
});

describe("completion", () => {
  it("lists engine methods after a receiver chain (Geometry.)", () => {
    const items = completion(ctx, URI, { line: 1, character: 11 });
    const labels = labelsOf(items);
    assert(labels.includes("distance"));
    assert(labels.includes("rotate_point"));
  });

  it("carries the signature in the completion detail", () => {
    const items = completion(ctx, URI, { line: 1, character: 11 });
    const dist = items.find((i) =>
      (i as { label: string }).label === "distance"
    ) as { detail?: string; kind?: number };
    assertEquals(dist.detail, "distance(point_one, point_two)");
    assertEquals(dist.kind, 2);
  });

  it("lists curated engine chains (args.)", () => {
    const items = completion(ctx, URI, { line: 2, character: 7 });
    const labels = labelsOf(items);
    assert(labels.includes("state"));
    assert(labels.includes("outputs"));
  });

  it("lists core methods on a literal receiver ([1, 2].)", () => {
    const items = completion(ctx, URI, { line: 3, character: 9 });
    const labels = labelsOf(items);
    assert(labels.includes("each"));
    assert(labels.includes("map"));
  });

  it("surfaces doc-only DragonRuby extensions on a literal receiver", () => {
    const items = completion(ctx, URI, { line: 3, character: 9 });
    const map2d = items.find((i) =>
      (i as { label: string }).label === "map_2d"
    ) as { documentation?: { value: string } } | undefined;
    assert(map2d, "expected map_2d from docs/api/array.md");
    assert((map2d.documentation?.value ?? "").length > 50);
  });

  it("lists Array class-level variants on the constant receiver (Array.)", () => {
    const items = completion(ctx, URI, { line: 4, character: 8 });
    const labels = labelsOf(items);
    assert(labels.includes("filter_map"));
    assert(labels.includes("map"));
  });

  it("falls back to workspace defs plus engine top-level modules", () => {
    const items = completion(ctx, URI, { line: 5, character: 7 });
    const labels = labelsOf(items);
    assert(labels.includes("spawn_enemy"));
    assert(labels.includes("tick"));
    const geometry = items.find((i) =>
      (i as { label: string }).label === "Geometry"
    ) as { kind?: number } | undefined;
    assert(geometry, "expected Geometry module in the fallback");
    assertEquals(geometry.kind, 9);
    // Easing has no engine source here, so it is not offered.
    assert(!labels.includes("Easing"));
  });

  it("attaches a rendered doc to an unambiguously documented def", () => {
    const items = completion(ctx, URI, { line: 5, character: 7 });
    const spawn = items.find((i) =>
      (i as { label: string }).label === "spawn_enemy"
    ) as { documentation?: { value: string } };
    assert(
      (spawn.documentation?.value ?? "").includes("Spawns enemies"),
    );
  });
});
