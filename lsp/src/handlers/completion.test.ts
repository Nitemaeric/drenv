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

// One-hop typed receivers: a local typed by a literal RHS (Array), and instance
// variable / local typed by `Klass.new` completing the class's own + inherited
// methods.
// Complete `recv.method` calls (cursor lands just after the dot): the trailing
// method keeps the receiver parsing cleanly instead of chaining into `end`, so
// the AST receiver resolves — the completion ignores the partial method text.
const TYPED = `class Base
  def shared
  end
end

class Animation < Base
  # Starts playback.
  def play
  end
  def stop
  end
end

class Sprite
  def setup
    @anim = Animation.new
  end

  def use_enemies
    enemies = []
    enemies.each
  end

  def use_anim
    @anim.play
  end

  def use_local
    local = Animation.new
    local.play
  end
end
`;

const TYPED_URI = "file:///test/typed.rb";

// deno-lint-ignore no-explicit-any
const labelsOf = (items: unknown[]): string[] =>
  items.map((i) => (i as any).label);

// Position just after the `.` following `needle` on its line.
const afterDot = (text: string, needle: string) => {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => l.includes(`${needle}.`));
  return {
    line,
    character: lines[line].indexOf(`${needle}.`) + needle.length + 1,
  };
};

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
  await Deno.writeTextFile(
    join(dir, "docs", "oss", "dragon", "args.rb"),
    [
      "module GTK",
      "  class Args",
      "    attr_accessor :outputs",
      "    attr_accessor :state",
      "  end",
      "end",
    ].join("\n"),
  );
  await Deno.writeTextFile(join(dir, "docs", "api", "array.md"), ARRAY_MD);

  const ws = new Workspace(ruby);
  const resolver = new Resolver(ws);
  const yard = new YardRenderer(resolver);
  const engine = await EngineIndex.build(ruby, dir);
  ctx = { ws, resolver, yard, engine };
  ws.indexFile(URI, FIXTURE);
  ws.indexFile(TYPED_URI, TYPED);
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

  it("scopes a bare identifier to reachable methods, locals, and constants", () => {
    const u = "file:///test/scope.rb";
    const src = [
      "class Camera",
      "  def scroll_bg", // unrelated class method — NOT reachable from Main
      "  end",
      "end",
      "module Main",
      "  def tick args",
      "    scene = pick",
      "    x", // <- completing here
      "  end",
      "  def helper", // Main's own method — reachable on self
      "  end",
      "end",
      "def top_helper", // top-level def — reachable everywhere
      "end",
      "",
    ].join("\n");
    ctx.ws.indexFile(u, src);
    const labels = labelsOf(completion(ctx, u, { line: 7, character: 5 }));

    assert(labels.includes("helper"), "self method");
    assert(labels.includes("top_helper"), "top-level def");
    assert(labels.includes("scene"), "local in scope");
    assert(labels.includes("Camera"), "class constant");
    // The unrelated class's method is not bare-callable from Main#tick.
    assert(!labels.includes("scroll_bg"));
  });

  it("completes core methods on a local typed by a literal (enemies = [])", () => {
    const items = completion(ctx, TYPED_URI, afterDot(TYPED, "enemies"));
    const labels = labelsOf(items);
    assert(labels.includes("each"), "expected mruby Array core");
    assert(labels.includes("map"));
    assert(labels.includes("map_2d"), "expected DragonRuby Array extension");
  });

  it("completes a class's own + inherited methods on an ivar (@anim.)", () => {
    const items = completion(ctx, TYPED_URI, afterDot(TYPED, "@anim"));
    const labels = labelsOf(items);
    assert(labels.includes("play"));
    assert(labels.includes("stop"));
    assert(labels.includes("shared"), "expected inherited method from Base");
    // Not the enclosing Sprite's own methods.
    assert(!labels.includes("use_anim"));
  });

  it("carries a rendered doc on a typed class-method completion", () => {
    const items = completion(ctx, TYPED_URI, afterDot(TYPED, "@anim"));
    const play = items.find((i) =>
      (i as { label: string }).label === "play"
    ) as { documentation?: { value: string }; kind?: number };
    assertEquals(play.kind, 2);
    assert((play.documentation?.value ?? "").includes("Starts playback"));
  });

  it("completes a local typed by Klass.new (local = Animation.new)", () => {
    const items = completion(ctx, TYPED_URI, afterDot(TYPED, "local"));
    const labels = labelsOf(items);
    assert(labels.includes("play"));
    assert(labels.includes("shared"));
  });

  it("types an ivar array through a dangling dot, not the def list", () => {
    const u = "file:///test/ivar.rb";
    const src =
      "class Game\n  def setup\n    @players = [{ n: 1 }]\n    @players.\n  end\nend\n";
    ctx.ws.indexFile(u, src);
    const items = completion(ctx, u, afterDot(src, "@players"));
    const labels = labelsOf(items);
    assert(labels.includes("each"), "expected Array core on @players");
    assert(labels.includes("map"));
    // Not the workspace's class/method names (the old bare-fallback bug).
    assert(!labels.includes("Animation"));
    assert(!labels.includes("Game"));
  });

  it("returns nothing for a member access on an untypeable receiver", () => {
    const u = "file:///test/untyped.rb";
    // `mystery` is a bare method call — no known type — so `.` completes to
    // nothing rather than dumping every workspace definition.
    const src = "def go\n  mystery.\nend\n";
    ctx.ws.indexFile(u, src);
    assertEquals(completion(ctx, u, afterDot(src, "mystery")), []);
  });
});
