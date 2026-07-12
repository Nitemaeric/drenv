import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";

import { Ruby } from "../ruby.ts";
import { Workspace } from "../workspace.ts";
import { Resolver } from "../resolve.ts";
import { YardRenderer } from "../yard.ts";
import { EngineIndex } from "../engine.ts";
import type { Ctx } from "./ctx.ts";
import { definition, references } from "./navigation.ts";

let ruby: Ruby;
let base: string;
let engine: EngineIndex;

beforeAll(async () => {
  ruby = await Ruby.init();
  base = await Deno.makeTempDir({ prefix: "drenv-nav-" });
  engine = await EngineIndex.build(ruby, join(base, "no-engine"));
});

afterAll(async () => {
  await Deno.remove(base, { recursive: true }).catch(() => {});
});

const uri = (name: string) => toFileUrl(join(base, name)).href;

const ctxOf = (files: Record<string, string>): Ctx => {
  const ws = new Workspace(ruby);
  for (const [name, text] of Object.entries(files)) {
    ws.indexFile(uri(name), text);
  }
  const resolver = new Resolver(ws);
  return { ws, resolver, yard: new YardRenderer(resolver), engine };
};

const at = (text: string, needle: string, line: number) => ({
  line,
  character: text.split("\n")[line].indexOf(needle) + 1,
});

const NAV = [
  "class Base", // 0
  "  def hud", // 1
  "  end", // 2
  "end", // 3
  "", // 4
  "class Zoom < Base", // 5
  "  def tick args", // 6
  "    hud", // 7
  "    args.foo", // 8
  "  end", // 9
  "end", // 10
  "", // 11
  "class Other", // 12
  "  def hud", // 13
  "  end", // 14
  "end", // 15
].join("\n");

describe("definition", () => {
  it("jumps a parameter to its def line, not elsewhere", () => {
    const ctx = ctxOf({ "a.rb": NAV });
    const out = definition(ctx, uri("a.rb"), at(NAV, "args", 8));
    assertEquals(out.length, 1);
    assertEquals(out[0].uri, uri("a.rb"));
    assertEquals(out[0].range.start.line, 6);
  });

  it("narrows a bare call through the superclass chain", () => {
    const ctx = ctxOf({ "a.rb": NAV });
    // Two `hud` defs exist (Base, Other); the call in Zoom#tick resolves to Base.
    const out = definition(ctx, uri("a.rb"), at(NAV, "hud", 7));
    assertEquals(out.length, 1);
    assertEquals(out[0].range.start.line, 1);
  });

  it("resolves a cross-file workspace def", () => {
    const ctx = ctxOf({
      "call.rb": "def tick args\n  spawn_enemy args\nend\n",
      "def.rb": "def spawn_enemy args\nend\n",
    });
    const out = definition(
      ctx,
      uri("call.rb"),
      at(
        "def tick args\n  spawn_enemy args\nend\n",
        "spawn_enemy",
        1,
      ),
    );
    assertEquals(out.length, 1);
    assertEquals(out[0].uri, uri("def.rb"));
    assertEquals(out[0].range.start.line, 0);
  });

  it("returns plain {uri, range} payloads, stripping Def extras", () => {
    const ctx = ctxOf({
      "call.rb": "def tick args\n  spawn_enemy args\nend\n",
      "def.rb": "# Spawns.\ndef spawn_enemy args\nend\n",
    });
    const out = definition(
      ctx,
      uri("call.rb"),
      at(
        "def tick args\n  spawn_enemy args\nend\n",
        "spawn_enemy",
        1,
      ),
    );
    assertEquals(Object.keys(out[0]).sort(), ["range", "uri"]);
    assert(!("container" in out[0]));
    assert(!("doc" in out[0]));
    assert(!("kind" in out[0]));
  });

  it("returns nothing on whitespace", () => {
    const ctx = ctxOf({ "a.rb": NAV });
    assertEquals(definition(ctx, uri("a.rb"), { line: 4, character: 0 }), []);
  });
});

describe("references", () => {
  it("scopes a local's references to its method", () => {
    const src = [
      "def one x", // 0
      "  x + 1", // 1
      "end", // 2
      "def two x", // 3
      "  x + 2", // 4
      "end", // 5
    ].join("\n");
    const ctx = ctxOf({ "a.rb": src });
    const out = references(ctx, uri("a.rb"), { line: 1, character: 2 });
    assertEquals(out.length, 2);
    assert(out.every((r) => r.uri === uri("a.rb")));
    assert(out.every((r) => r.range.start.line <= 2));
  });

  it("finds a workspace def's call sites across files", () => {
    const ctx = ctxOf({
      "a.rb": "def helper\nend\nhelper\n",
      "b.rb": "helper\n",
    });
    const out = references(
      ctx,
      uri("a.rb"),
      at("def helper\nend\nhelper\n", "helper", 2),
    );
    assertEquals(out.length, 3);
    const uris = new Set(out.map((r) => r.uri));
    assert(uris.has(uri("a.rb")));
    assert(uris.has(uri("b.rb")));
  });

  it("returns nothing on whitespace", () => {
    const ctx = ctxOf({ "a.rb": NAV });
    assertEquals(references(ctx, uri("a.rb"), { line: 4, character: 0 }), []);
  });
});
