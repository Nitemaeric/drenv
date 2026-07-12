import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { Ruby } from "../ruby.ts";
import { EngineIndex } from "../engine.ts";
import { Workspace } from "../workspace.ts";
import { Resolver } from "../resolve.ts";
import { YardRenderer } from "../yard.ts";
import type { Ctx } from "./ctx.ts";
import { diagnostics } from "./diagnostics.ts";

// intersect_rect?: two required + one optional positional; rect_one's body
// reads x/y/w/h so it derives a duck shape. anchor_rect: one positional + a
// required and an optional keyword. dot: exactly two required. path: one
// required plus a rest — the "at least N" arity phrasing.
const GEOMETRY_RB = `module Geometry
  def intersect_rect?(rect_one, rect_two, tolerance = 0.1)
    rect_one.x
    rect_one.y
    rect_one.w
    rect_one.h
    rect_two.x
  end

  def anchor_rect(rect, anchor_x:, anchor_y: 0.5)
    rect.x
  end

  def dot(a, b)
  end

  def path(start, *rest)
  end

  def place(target, at:)
    at.x
    at.y
  end
end
`;

type Diag = {
  message: string;
  severity: number;
  code?: string;
  codeDescription?: { href: string };
};

let ruby: Ruby;
let root: string;
let engine: EngineIndex;
let emptyEngine: EngineIndex;

const makeCtx = (eng: EngineIndex): Ctx => {
  const ws = new Workspace(ruby);
  const resolver = new Resolver(ws);
  const yard = new YardRenderer(resolver);
  return { ws, resolver, yard, engine: eng };
};

const run = (eng: EngineIndex, text: string): Diag[] => {
  const ctx = makeCtx(eng);
  const uri = "file:///test.rb";
  ctx.ws.indexFile(uri, text);
  return diagnostics(ctx, uri) as Diag[];
};

const messages = (diags: Diag[]): string[] => diags.map((d) => d.message);
const has = (diags: Diag[], substr: string): boolean =>
  diags.some((d) => d.message.includes(substr));

beforeAll(async () => {
  ruby = await Ruby.init();
  root = await Deno.makeTempDir({ prefix: "drenv-diagnostics-" });
  const dir = join(root, "7.11");
  await ensureDir(join(dir, "docs", "oss", "dragon"));
  await ensureDir(join(dir, "docs", "api"));
  await Deno.writeTextFile(
    join(dir, "docs", "oss", "dragon", "geometry.rb"),
    GEOMETRY_RB,
  );
  engine = await EngineIndex.build(ruby, dir);
  emptyEngine = await EngineIndex.build(ruby, join(root, "does-not-exist"));
});

afterAll(async () => {
  await Deno.remove(root, { recursive: true });
});

describe("diagnostics — engine fixture sanity", () => {
  it("indexes Geometry as a validity receiver with a non-empty api entry", () => {
    assert(engine.validityReceivers.has("Geometry"));
    assert((engine.api.get("Geometry")?.length ?? 0) > 0);
  });
});

describe("diagnostics — syntax errors", () => {
  it("names the missing node in the message", () => {
    const diags = run(engine, "1 +\n");
    assert(
      has(diags, "syntax error: missing identifier"),
      messages(diags).join(" | "),
    );
    const err = diags.find((d) => d.message.includes("syntax error"))!;
    assertEquals(err.severity, 1);
  });

  it("flags a bare ERROR node", () => {
    const diags = run(engine, "def foo(\n");
    const err = diags.find((d) => d.message === "syntax error");
    assert(err, messages(diags).join(" | "));
    assertEquals(err.severity, 1);
  });

  it("fires with no engine installed (engine-independent)", () => {
    const diags = run(emptyEngine, "1 +\n");
    assert(has(diags, "syntax error"));
  });
});

describe("diagnostics — method validity", () => {
  it("warns on an unknown method, naming the engine version", () => {
    const diags = run(engine, "Geometry.nope(1, 2)\n");
    assert(
      has(diags, "`nope` is not a method on Geometry (DragonRuby 7.11)"),
      messages(diags).join(" | "),
    );
    assertEquals(diags[0].severity, 2);
  });

  it("does not warn on a known method", () => {
    const diags = run(engine, "Geometry.intersect_rect?(a, b)\n");
    assertEquals(messages(diags), []);
  });
});

describe("diagnostics — positional arity", () => {
  it("reports a range for optional trailing params", () => {
    const diags = run(engine, "Geometry.intersect_rect?(a)\n");
    assert(
      has(
        diags,
        "Geometry.intersect_rect? expects 2..3 positional argument(s) — " +
          "`intersect_rect?(rect_one, rect_two, tolerance = 0.1)` — got 1",
      ),
      messages(diags).join(" | "),
    );
  });

  it("reports an exact count when there are no optionals", () => {
    const diags = run(engine, "Geometry.dot(a)\n");
    assert(
      has(
        diags,
        "Geometry.dot expects 2 positional argument(s) — `dot(a, b)` — got 1",
      ),
      messages(diags).join(" | "),
    );
  });

  it("reports 'at least N' when a rest param is present", () => {
    const diags = run(engine, "Geometry.path()\n");
    assert(
      has(
        diags,
        "Geometry.path expects at least 1 positional argument(s) — " +
          "`path(start, *rest)` — got 0",
      ),
      messages(diags).join(" | "),
    );
  });

  it("collapses trailing bare pairs into an options hash on a kwarg-less method", () => {
    // `dot(a, b)` has no keyword params; the idiomatic `dot(a, x: 1, y: 2)`
    // option hash must not read as three positional args.
    const diags = run(engine, "Geometry.dot(a, x: 1, y: 2)\n");
    assert(
      !has(diags, "positional argument(s)"),
      messages(diags).join(" | "),
    );
  });

  it("still counts a single trailing pair (no options hash to collapse)", () => {
    // One trailing pair is a lone arg, not a hash — `dot` is short a positional.
    const diags = run(engine, "Geometry.dot(x: 1)\n");
    assert(
      has(diags, "Geometry.dot expects 2 positional argument(s)"),
      messages(diags).join(" | "),
    );
  });
});

describe("diagnostics — keyword arguments", () => {
  it("flags an unknown keyword, listing the accepted ones", () => {
    const diags = run(engine, "Geometry.anchor_rect(r, anchor_x: 1, bad: 2)\n");
    assert(
      has(
        diags,
        "`bad:` is not a keyword of Geometry.anchor_rect — " +
          "accepted: anchor_x:, anchor_y:",
      ),
      messages(diags).join(" | "),
    );
  });

  it("flags a missing required keyword", () => {
    const diags = run(engine, "Geometry.anchor_rect(r)\n");
    assert(
      has(
        diags,
        "Geometry.anchor_rect is missing required keyword(s) `anchor_x:` — " +
          "`anchor_rect(rect, anchor_x:, anchor_y: 0.5)`",
      ),
      messages(diags).join(" | "),
    );
  });

  it("normalizes hash-rocket symbol keys for keyword matching", () => {
    // `:anchor_x => 1` must resolve to the `anchor_x:` keyword, not read as an
    // unknown/missing one.
    const diags = run(engine, "Geometry.anchor_rect(r, :anchor_x => 1)\n");
    assertEquals(messages(diags), []);
  });

  it("treats **opts as a kwarg forwarder, not a positional argument", () => {
    // hash_splat neither counts toward positional arity nor leaves required
    // keywords unsatisfied — the splat may supply them.
    const diags = run(engine, "Geometry.anchor_rect(r, **opts)\n");
    assertEquals(messages(diags), []);
  });

  it("does not emit an arity error when **opts trails positionals", () => {
    const diags = run(engine, "Geometry.dot(a, b, **opts)\n");
    assert(
      !has(diags, "positional argument(s)"),
      messages(diags).join(" | "),
    );
  });
});

describe("diagnostics — duck shape", () => {
  it("flags a hash literal missing the read geometric attrs", () => {
    const diags = run(
      engine,
      "Geometry.intersect_rect?({ x: 1, y: 2 }, other)\n",
    );
    assert(
      has(
        diags,
        "argument 1 (`rect_one`) is missing `.h`, `.w` — " +
          "Geometry.intersect_rect? reads rect_one.h, rect_one.w, " +
          "rect_one.x, rect_one.y",
      ),
      messages(diags).join(" | "),
    );
  });

  it("flags a keyword hash-literal value missing attrs", () => {
    const diags = run(engine, "Geometry.place(t, at: { x: 1 })\n");
    assert(
      has(
        diags,
        "keyword `at:` (`at`) is missing `.y` — Geometry.place reads at.x, at.y",
      ),
      messages(diags).join(" | "),
    );
  });
});

describe("diagnostics — one-hop literal shape check", () => {
  it("resolves an identifier to its same-method literal hash and flags it", () => {
    const diags = run(
      engine,
      "def go\n  p = { x: 0 }\n  Geometry.intersect_rect?(p, q)\nend\n",
    );
    assert(
      has(diags, "argument 1 (`rect_one`) is missing `.h`, `.w`"),
      messages(diags).join(" | "),
    );
  });

  it("stays silent when the literal is reassigned (uncertain type)", () => {
    const diags = run(
      engine,
      "def go\n  p = { x: 0 }\n  p = other\n  " +
        "Geometry.intersect_rect?(p, q)\nend\n",
    );
    assertEquals(messages(diags), []);
  });

  it("stays silent when the local is element-mutated before use", () => {
    const diags = run(
      engine,
      "def go\n  p = { x: 0 }\n  p[:w] = 1\n  " +
        "Geometry.intersect_rect?(p, q)\nend\n",
    );
    assertEquals(messages(diags), []);
  });

  it("stays silent when the literal is not a hash", () => {
    const diags = run(
      engine,
      "def go\n  p = [1, 2]\n  Geometry.intersect_rect?(p, q)\nend\n",
    );
    assertEquals(messages(diags), []);
  });

  it("resolves an identifier keyword value through one hop", () => {
    const diags = run(
      engine,
      "def go\n  a = { x: 1 }\n  Geometry.place(t, at: a)\nend\n",
    );
    assert(
      has(diags, "keyword `at:` (`at`) is missing `.y`"),
      messages(diags).join(" | "),
    );
  });
});

describe("diagnostics — new perf rules", () => {
  it("flags an array primitive pushed to a render layer", () => {
    const diags = run(engine, "args.outputs.sprites << [1, 2]\n");
    const d = diags.find((x) => x.code === "array-primitives");
    assert(d, messages(diags).join(" | "));
    assertEquals(d.severity, 3);
    assert((d.codeDescription?.href ?? "").includes("rendering-primitives"));
  });

  it("does not flag a hash pushed to a render layer", () => {
    const diags = run(engine, "args.outputs.sprites << { x: 1 }\n");
    assert(!diags.some((d) => d.code === "array-primitives"));
  });

  it("keeps a hint at Information in a method with no known callers", () => {
    // `orphan` is never called → in-degree 0 → cannot prove cold → Information.
    const diags = run(
      engine,
      "def orphan\n  xs.map { |x| x }\n  y = 1\nend\n",
    );
    const d = diags.find((x) => x.code === "unused-map");
    assert(d, messages(diags).join(" | "));
    assertEquals(d.severity, 3);
  });

  it("softens a hint to Hint when the method has a caller but no tick path", () => {
    // `helper` is called by `side` (in-degree > 0) but no tick reaches it.
    const src = [
      "def side\n  helper\nend",
      "def helper\n  xs.map { |x| x }\n  y = 1\nend",
    ].join("\n\n") + "\n";
    const diags = run(engine, src);
    const d = diags.find((x) => x.code === "unused-map");
    assert(d, messages(diags).join(" | "));
    assertEquals(d.severity, 4);
  });

  it("keeps a hint at Information on a tick-reachable method", () => {
    const src = [
      "def tick args\n  recurse 1\nend",
      "def recurse n\n  recurse(n - 1)\nend",
    ].join("\n\n") + "\n";
    const diags = run(engine, src);
    const d = diags.find((x) => x.code === "recursion");
    assert(d, messages(diags).join(" | "));
    assertEquals(d.severity, 3);
  });
});

describe("diagnostics — mutation during iteration (perf hint)", () => {
  const SRC = "list.each do |item|\n  list.delete(item)\nend\n";

  it("emits an Information diagnostic linking the performance guide", () => {
    const diags = run(engine, SRC);
    const hint = diags.find((d) => d.code === "array-manipulation");
    assert(hint, messages(diags).join(" | "));
    assertEquals(hint.severity, 3);
    assertEquals(
      hint.codeDescription?.href,
      "https://docs.dragonruby.org/#/guides/troubleshoot-performance?id=array-manipulation",
    );
    assert(hint.message.includes("is mutated (`delete`)"));
    assert(
      hint.message.includes("Troubleshoot Performance → Array Manipulation"),
    );
  });

  it("flags `<<` appends inside the loop", () => {
    const diags = run(engine, "list.each do |item|\n  list << item\nend\n");
    assert(has(diags, "is appended to (`<<`)"), messages(diags).join(" | "));
  });

  it("fires with no engine installed (engine-independent)", () => {
    const diags = run(emptyEngine, SRC);
    assert(diags.some((d) => d.code === "array-manipulation"));
  });
});

describe("diagnostics — certainty gates", () => {
  it("does not warn for a receiver outside VALIDITY_RECEIVERS", () => {
    // Foo is a constant but not an engine module we own.
    assertEquals(messages(run(engine, "Foo.whatever(1, 2, 3)\n")), []);
    // Array gets completions, never validity/arity warnings.
    assertEquals(messages(run(engine, "Array.bogus(1)\n")), []);
  });

  it("does not warn for a non-constant (literal) receiver", () => {
    assertEquals(messages(run(engine, "[1, 2].bogus_method\n")), []);
  });

  it("does not shape-check non-literal arguments", () => {
    // Identifiers can't be duck-shape-checked — no type inference. Arity is
    // satisfied (2 args), so nothing is emitted.
    assertEquals(
      messages(run(engine, "Geometry.intersect_rect?(foo, bar)\n")),
      [],
    );
  });

  it("emits nothing about an engine module when no engine is installed", () => {
    // validityReceivers still has Geometry, but api has no entry — the gate
    // requires both, so no validity/arity/kwarg/shape diagnostics fire.
    const diags = run(emptyEngine, "Geometry.nope(1)\n");
    assertEquals(messages(diags), []);
  });
});
