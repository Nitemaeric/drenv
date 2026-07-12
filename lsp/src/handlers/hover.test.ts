import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join, toFileUrl } from "@std/path";

import { Ruby } from "../ruby.ts";
import { Workspace } from "../workspace.ts";
import { Resolver } from "../resolve.ts";
import { YardRenderer } from "../yard.ts";
import { EngineIndex } from "../engine.ts";
import type { Ctx } from "./ctx.ts";
import { hover } from "./hover.ts";

let ruby: Ruby;
let base: string;
let emptyEngine: EngineIndex;

beforeAll(async () => {
  ruby = await Ruby.init();
  base = await Deno.makeTempDir({ prefix: "drenv-hover-" });
  emptyEngine = await EngineIndex.build(ruby, join(base, "no-engine"));
});

afterAll(async () => {
  await Deno.remove(base, { recursive: true }).catch(() => {});
});

const uri = (name: string) => toFileUrl(join(base, name)).href;

/** A Ctx over one or more in-memory files, with the given engine. */
const ctxOf = (
  files: Record<string, string>,
  engine: EngineIndex = emptyEngine,
): Ctx => {
  const ws = new Workspace(ruby);
  for (const [name, text] of Object.entries(files)) {
    ws.indexFile(uri(name), text);
  }
  const resolver = new Resolver(ws);
  return { ws, resolver, yard: new YardRenderer(resolver), engine };
};

/** Position just inside the first occurrence of `needle` on `line`. */
const at = (text: string, needle: string, line?: number) => {
  const lines = text.split("\n");
  const row = line ?? lines.findIndex((l) => l.includes(needle));
  return { line: row, character: lines[row].indexOf(needle) + 1 };
};

const value = (result: unknown): string =>
  (result as { contents?: { value?: string } })?.contents?.value ?? "";

const FX = [
  "module Fx", // 0
  "  # Coordinates screen shake.", // 1
  "  #", // 2
  "  # @param intensity [Float] how hard to shake", // 3
  "  class Shaker < Base", // 4
  "    # Current shake strength in pixels.", // 5
  "    attr_reader :strength", // 6
  "", // 7
  "    # Builds a shaker.", // 8
  "    #", // 9
  "    # @param intensity [Float] initial strength", // 10
  "    # @return [Shaker] the new shaker", // 11
  "    def initialize intensity", // 12
  "      @strength = intensity", // 13
  "      total = intensity * 2", // 14
  "      [1, 2].each do |item|", // 15
  "        total += item", // 16
  "      end", // 17
  "    end", // 18
  "  end", // 19
  "", // 20
  "  class Fader", // 21
  "    # Builds a fader.", // 22
  "    def initialize", // 23
  "    end", // 24
  "  end", // 25
  "end", // 26
  "", // 27
  "class Base", // 28
  "  # Draws the shared heads-up display.", // 29
  "  def hud", // 30
  "  end", // 31
  "end", // 32
  "", // 33
  "class ZoomScene < Base", // 34
  "  def tick", // 35
  "    hud", // 36
  "  end", // 37
  "end", // 38
  "", // 39
  "class OtherScene", // 40
  "  def hud", // 41
  "  end", // 42
  "end", // 43
].join("\n");

describe("hover — instance/class variable (attr-doc borrowing)", () => {
  it("shows the enclosing class and borrows a same-named attr's doc", () => {
    const ctx = ctxOf({ "a.rb": FX });
    const out = value(hover(ctx, uri("a.rb"), at(FX, "@strength", 13)));
    assertStringIncludes(
      out,
      "**@strength** — instance variable of `Fx::Shaker`",
    );
    assertStringIncludes(out, "Current shake strength in pixels.");
  });

  it("renders a class variable with its kind label", () => {
    const src = [
      "class Counter", // 0
      "  def bump", // 1
      "    @@count = 1", // 2
      "  end", // 3
      "end", // 4
    ].join("\n");
    const ctx = ctxOf({ "c.rb": src });
    const out = value(hover(ctx, uri("c.rb"), at(src, "@@count", 2)));
    assertStringIncludes(out, "**@@count** — class variable of `Counter`");
  });
});

describe("hover — engine api", () => {
  it("shows engine doc when receiver.word appears on the line", async () => {
    const dir = join(base, "engine", "7.11");
    await ensureDir(join(dir, "docs", "oss", "dragon"));
    await ensureDir(join(dir, "docs", "api"));
    await Deno.writeTextFile(
      join(dir, "docs", "oss", "dragon", "geometry.rb"),
      "module Geometry\n" +
        "  def distance point_one, point_two\n" +
        "  end\n" +
        "end\n",
    );
    await Deno.writeTextFile(
      join(dir, "docs", "api", "geometry.md"),
      "# Geometry\n\n## `distance`\n\nDistance between two points.\n",
    );
    const engine = await EngineIndex.build(ruby, dir);

    const src = "def go\n  Geometry.distance(a, b)\nend\n";
    const ctx = ctxOf({ "g.rb": src }, engine);
    const out = value(hover(ctx, uri("g.rb"), at(src, "distance", 1)));
    assertStringIncludes(out, "**Geometry.distance** — DragonRuby 7.11");
    assertStringIncludes(out, "Distance between two points.");
  });
});

describe("hover — receiver-typed method (one hop)", () => {
  it("borrows engine docs for a core method on a literal receiver", async () => {
    const dir = join(base, "engine-array", "7.11");
    await ensureDir(join(dir, "docs", "oss", "dragon"));
    await ensureDir(join(dir, "docs", "api"));
    await Deno.writeTextFile(
      join(dir, "docs", "api", "array.md"),
      "# Array\n\n## `map_2d`\n\nMaps over a two-dimensional grid.\n",
    );
    const engine = await EngineIndex.build(ruby, dir);

    const src = "def go\n  [1, 2].map_2d\nend\n";
    const ctx = ctxOf({ "m.rb": src }, engine);
    const out = value(hover(ctx, uri("m.rb"), at(src, "map_2d", 1)));
    assertStringIncludes(out, "**Array#map_2d** — DragonRuby 7.11");
    assertStringIncludes(out, "Maps over a two-dimensional grid.");
  });

  it("resolves a method against an ivar's `Klass.new` type", () => {
    const src = [
      "class Animation", // 0
      "  # Starts playback.", // 1
      "  def play", // 2
      "  end", // 3
      "end", // 4
      "class Sprite", // 5
      "  def setup", // 6
      "    @anim = Animation.new", // 7
      "  end", // 8
      "  def update", // 9
      "    @anim.play", // 10
      "  end", // 11
      "end", // 12
    ].join("\n");
    const ctx = ctxOf({ "s.rb": src });
    const out = value(hover(ctx, uri("s.rb"), at(src, "play", 10)));
    assertStringIncludes(out, "**Animation#play** — defined in");
    assertStringIncludes(out, "Starts playback.");
  });

  it("dispatches through a unique method's @return (camera.ui.view)", () => {
    const src = [
      "class UI", // 0
      "  # Renders the active view.", // 1
      "  def view", // 2
      "  end", // 3
      "end", // 4
      "class Camera", // 5
      "  # @return [UI] the ui manager", // 6
      "  def ui", // 7
      "  end", // 8
      "  def tick", // 9
      "    ui.view", // 10
      "  end", // 11
      "end", // 12
    ].join("\n");
    const ctx = ctxOf({ "u.rb": src });
    const out = value(hover(ctx, uri("u.rb"), at(src, "view", 10)));
    assertStringIncludes(out, "**UI#view** — defined in");
    assertStringIncludes(out, "Renders the active view.");
  });
});

describe("hover — locals", () => {
  it("resolves a parameter with its @param type and description", () => {
    const ctx = ctxOf({ "a.rb": FX });
    // The `intensity` usage on the RHS of the assignment.
    const pos = at(FX, "intensity", 13);
    const out = value(hover(ctx, uri("a.rb"), pos));
    assertStringIncludes(out, "parameter of `Fx::Shaker#initialize`");
    assertStringIncludes(out, "(`Float`) initial strength");
    assert(!out.includes("definitions"));
  });

  it("links a @param type that resolves to a workspace constant", () => {
    const src = [
      "class Widget", // 0
      "end", // 1
      "# @param thing [Widget] the widget", // 2
      "def use thing", // 3
      "  thing", // 4
      "end", // 5
    ].join("\n");
    const ctx = ctxOf({ "w.rb": src });
    const out = value(hover(ctx, uri("w.rb"), at(src, "thing", 4)));
    assertStringIncludes(out, "parameter of `use`");
    assertStringIncludes(out, "([`Widget`](");
  });

  it("shows a block parameter plainly (no @param doc)", () => {
    const ctx = ctxOf({ "a.rb": FX });
    const out = value(hover(ctx, uri("a.rb"), at(FX, "item", 16)));
    assertStringIncludes(
      out,
      "**item** — block parameter of `Fx::Shaker#initialize`",
    );
    assert(!out.includes("---"));
  });

  it("shows a local variable plainly", () => {
    const ctx = ctxOf({ "a.rb": FX });
    const out = value(hover(ctx, uri("a.rb"), at(FX, "total", 16)));
    assertStringIncludes(
      out,
      "**total** — local variable of `Fx::Shaker#initialize`",
    );
  });
});

describe("hover — def-site pinning", () => {
  it("pins a same-named def to its own container and doc", () => {
    const ctx = ctxOf({ "a.rb": FX });
    const out = value(hover(ctx, uri("a.rb"), at(FX, "initialize", 12)));
    assertStringIncludes(out, "**Fx::Shaker#initialize**");
    assertStringIncludes(out, "Builds a shaker.");
    assert(!out.includes("Builds a fader"));
  });

  it("renders a class def block that attaches to the enclosing module", () => {
    const ctx = ctxOf({ "a.rb": FX });
    const out = value(hover(ctx, uri("a.rb"), at(FX, "Shaker", 4)));
    assertStringIncludes(out, "**Fx::Shaker**");
    assertStringIncludes(out, "Coordinates screen shake.");
    assertStringIncludes(out, "`intensity` (`Float`)");
  });
});

describe("hover — context candidates for a bare call", () => {
  it("resolves via the enclosing class + superclass chain", () => {
    const ctx = ctxOf({ "a.rb": FX });
    const out = value(hover(ctx, uri("a.rb"), at(FX, "hud", 36)));
    assertStringIncludes(out, "**Base#hud**");
    assertStringIncludes(out, "Draws the shared");
    assert(!out.includes("definitions"));
  });
});

describe("hover — reopened-namespace collapse", () => {
  it("collapses one qualified name across files (3-file cap, one doc)", () => {
    const def = (doc: string) =>
      `class Widget\n${doc}  def refresh\n  end\nend\n`;
    const files: Record<string, string> = {
      "r1.rb": def("  # Refreshes the widget.\n"),
      "r2.rb": def(""),
      "r3.rb": def(""),
      "r4.rb": def(""),
      "call.rb": "refresh\n",
    };
    const ctx = ctxOf(files);
    const out = value(hover(ctx, uri("call.rb"), { line: 0, character: 0 }));
    assertStringIncludes(out, "**Widget#refresh** — defined in");
    // Four files, capped at three with a "+1 more" suffix.
    assertStringIncludes(out, "(+1 more)");
    // The single documented copy supplies the doc even though it lives in r1.
    assertStringIncludes(out, "Refreshes the widget.");
  });
});

describe("hover — ambiguous candidate list", () => {
  it("lists up to five candidates and counts the rest", () => {
    const files: Record<string, string> = {};
    for (const cls of ["A", "B", "C", "D", "E", "F"]) {
      files[`${cls}.rb`] = `class ${cls}\n  def ping\n  end\nend\n`;
    }
    files["call.rb"] = "ping\n";
    const ctx = ctxOf(files);
    const out = value(hover(ctx, uri("call.rb"), { line: 0, character: 0 }));
    assertStringIncludes(out, "**ping** — 6 definitions");
    assertEquals((out.match(/^- `/gm) ?? []).length, 5);
    assertStringIncludes(out, "…and 1 more");
  });
});

describe("hover — bare constant lexical lookup", () => {
  const LIB =
    "module Conjuration\n  module UI\n    # Flexbox layout.\n    class Layout\n    end\n  end\nend\n";

  it("does not resolve to an unrelated namespace sharing the name", () => {
    const main = "module Main\n  def boot\n    Layout\n  end\nend\n";
    const ctx = ctxOf({ "lib.rb": LIB, "main.rb": main });
    // `Layout` inside Main sees Main::Layout / ::Layout, never Conjuration's.
    assertEquals(hover(ctx, uri("main.rb"), at(main, "Layout", 2)), null);
  });

  it("resolves to a lexically-visible constant", () => {
    const main =
      "module Main\n  # A grid.\n  class Layout\n  end\n  def boot\n    Layout\n  end\nend\n";
    const ctx = ctxOf({ "lib.rb": LIB, "main.rb": main });
    const out = value(hover(ctx, uri("main.rb"), at(main, "Layout", 5)));
    assertStringIncludes(out, "**Main::Layout**");
    assertStringIncludes(out, "A grid.");
  });
});

describe("hover — misses", () => {
  it("returns null on whitespace", () => {
    const ctx = ctxOf({ "a.rb": FX });
    assertEquals(hover(ctx, uri("a.rb"), { line: 7, character: 0 }), null);
  });

  it("returns null for an unknown identifier", () => {
    const ctx = ctxOf({ "a.rb": "def go\n  nowhere\nend\n" });
    assertEquals(
      hover(ctx, uri("a.rb"), at("def go\n  nowhere\nend\n", "nowhere", 1)),
      null,
    );
  });
});
