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
import { signatureHelp } from "./signature.ts";

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

const FIXTURE = `def sig_demo
  Geometry.distance({x: 0, y: 0}, {x: 3, y: 4})
  Geometry.rotate_point point_a, angle_b
  Geometry.rotate_point(1, 2, 3, 4)
  Geometry.distance()
  local.thing(1, 2)
end
`;

// A doc-only (C-implemented) Array method whose single code fence makes its
// signature unambiguous — reachable through a one-hop typed variable receiver.
const ARRAY_MD = [
  "# Array",
  "",
  "## `combine`",
  "",
  "Combines two collections.",
  "",
  "```ruby",
  "def combine other, weight",
  "end",
  "```",
  "",
  "## `Array` Class Methods",
  "",
  "- `filter_map`",
].join("\n");

const TYPED = `def typed_sig
  items = []
  items.combine(a, b)
end
`;

const URI = "file:///test/sig.rb";
const TYPED_URI = "file:///test/typed_sig.rb";

// deno-lint-ignore no-explicit-any
type Sig = any;

let ruby: Ruby;
let root: string;
let ctx: Ctx;

beforeAll(async () => {
  ruby = await Ruby.init();
  root = await Deno.makeTempDir({ prefix: "drenv-signature-" });
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
  ws.indexFile(TYPED_URI, TYPED);
});

afterAll(async () => {
  await Deno.remove(root, { recursive: true });
});

// The distance call is on line index 1.
const distanceLine = FIXTURE.split("\n").findIndex((l) =>
  l.includes("Geometry.distance({")
);
const rotateLine = FIXTURE.split("\n").findIndex((l) =>
  l.includes("rotate_point point_a")
);
const overArgLine = FIXTURE.split("\n").findIndex((l) =>
  l.includes("rotate_point(1, 2, 3, 4)")
);

describe("signatureHelp", () => {
  it("renders the signature and parameters of an engine call", () => {
    const line = FIXTURE.split("\n")[distanceLine];
    const sig: Sig = signatureHelp(ctx, URI, {
      line: distanceLine,
      character: line.indexOf("({") + 2, // inside the first argument
    });
    assert(sig);
    assertEquals(
      sig.signatures[0].label,
      "Geometry.distance(point_one, point_two)",
    );
    assertEquals(sig.signatures[0].parameters.length, 2);
    assertEquals(sig.activeSignature, 0);
  });

  it("tracks the active parameter from the cursor position", () => {
    const line = FIXTURE.split("\n")[distanceLine];
    const first: Sig = signatureHelp(ctx, URI, {
      line: distanceLine,
      character: line.indexOf("{x: 0") + 2,
    });
    assertEquals(first.activeParameter, 0);

    const second: Sig = signatureHelp(ctx, URI, {
      line: distanceLine,
      character: line.indexOf("{x: 3") + 2,
    });
    assertEquals(second.activeParameter, 1);
  });

  it("handles paren-less command calls", () => {
    const line = FIXTURE.split("\n")[rotateLine];
    const sig: Sig = signatureHelp(ctx, URI, {
      line: rotateLine,
      character: line.indexOf("angle_b") + 3,
    });
    assert(sig, "expected signature help on a paren-less call");
    assertEquals(
      sig.signatures[0].label,
      "Geometry.rotate_point(point, angle, around = nil)",
    );
    assertEquals(sig.activeParameter, 1);
  });

  it("clamps the active parameter to the last one", () => {
    // Four arguments against a three-param signature drives the raw active
    // index to 4; without the clamp activeParameter would exceed the last
    // parameter (index 2).
    const line = FIXTURE.split("\n")[overArgLine];
    const sig: Sig = signatureHelp(ctx, URI, {
      line: overArgLine,
      character: line.length, // past every argument
    });
    assertEquals(sig.signatures[0].parameters.length, 3);
    assertEquals(sig.activeParameter, 2);
  });

  it("returns null when the receiver has no engine entry", () => {
    const line = FIXTURE.split("\n").findIndex((l) =>
      l.includes("local.thing")
    );
    const sig = signatureHelp(ctx, URI, { line, character: 10 });
    assertEquals(sig, null);
  });

  it("returns null outside any call", () => {
    const sig = signatureHelp(ctx, URI, { line: 0, character: 3 });
    assertEquals(sig, null);
  });

  it("helps a one-hop typed variable receiver (items = []; items.combine)", () => {
    const line = TYPED.split("\n").findIndex((l) =>
      l.includes("items.combine")
    );
    const col = TYPED.split("\n")[line].indexOf("(a,") + 1;
    const sig: Sig = signatureHelp(ctx, TYPED_URI, { line, character: col });
    assert(sig, "expected signature help via the inferred Array type");
    assertEquals(sig.signatures[0].label, "items.combine(other, weight)");
    assertEquals(sig.signatures[0].parameters.length, 2);
    assertEquals(sig.activeParameter, 0);
  });
});
