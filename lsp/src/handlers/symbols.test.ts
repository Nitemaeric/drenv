import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";

import { Ruby } from "../ruby.ts";
import { Workspace } from "../workspace.ts";
import { Resolver } from "../resolve.ts";
import { YardRenderer } from "../yard.ts";
import { EngineIndex } from "../engine.ts";
import type { Ctx } from "./ctx.ts";
import {
  documentHighlight,
  documentSymbols,
  workspaceSymbols,
} from "./symbols.ts";

let ruby: Ruby;
let base: string;
let ctx: Ctx;

const SRC = [
  "module Game", // 0
  "  TILE = 16", // 1
  "  class Player", // 2
  "    attr_accessor :hp", // 3
  "    def self.spawn", // 4
  "    end", // 5
  "    class << self", // 6
  "      def registry", // 7
  "      end", // 8
  "    end", // 9
  "    def update", // 10
  "      speed = 1", // 11
  "      speed + speed", // 12
  "    end", // 13
  "  end", // 14
  "end", // 15
  "def tick args", // 16
  "end", // 17
  "",
].join("\n");

const uri = (name: string) => toFileUrl(join(base, name)).href;

beforeAll(async () => {
  ruby = await Ruby.init();
  base = await Deno.makeTempDir({ prefix: "drenv-symbols-" });
  const engine = await EngineIndex.build(ruby, join(base, "no-engine"));
  const ws = new Workspace(ruby);
  ws.indexFile(uri("game.rb"), SRC);
  ws.indexFile(uri("other.rb"), "class PlayerHud\nend\n");
  const resolver = new Resolver(ws);
  ctx = { ws, resolver, yard: new YardRenderer(resolver), engine };
});

afterAll(async () => {
  await Deno.remove(base, { recursive: true }).catch(() => {});
});

// deno-lint-ignore no-explicit-any
type Sym = any;
const outline = (syms: Sym[]): unknown[] =>
  syms.map((s) =>
    s.children ? [s.name, s.kind, outline(s.children)] : [s.name, s.kind]
  );

describe("documentSymbols", () => {
  it("nests members under their namespaces", () => {
    assertEquals(outline(documentSymbols(ctx, uri("game.rb"))), [
      ["Game", 2, [
        ["TILE", 14],
        ["Player", 5, [
          ["hp", 7],
          ["self.spawn", 6],
          ["self.registry", 6],
          ["update", 6],
        ]],
      ]],
      ["tick", 12],
    ]);
  });

  it("selects the name, spanning the whole definition", () => {
    const [game] = documentSymbols(ctx, uri("game.rb")) as Sym[];
    assertEquals(game.range.start.line, 0);
    assertEquals(game.range.end.line, 15);
    assertEquals(game.selectionRange.start, { line: 0, character: 7 });
  });
});

describe("workspaceSymbols", () => {
  it("ranks exact and prefix matches before fuzzy ones", () => {
    const names = (workspaceSymbols(ctx, "player") as Sym[]).map((s) => s.name);
    assertEquals(names, ["Player", "PlayerHud"]);
    const fuzzy = (workspaceSymbols(ctx, "regy") as Sym[])[0];
    assertEquals(
      [fuzzy.name, fuzzy.kind, fuzzy.containerName],
      ["self.registry", 6, "Game::Player"],
    );
  });
});

describe("documentHighlight", () => {
  it("highlights a local's uses within its method", () => {
    const hl = documentHighlight(ctx, uri("game.rb"), {
      line: 12,
      character: 7,
    }) as Sym[];
    assertEquals(
      hl.map((h) => [h.range.start.line, h.range.start.character]),
      [[11, 6], [12, 6], [12, 14]],
    );
  });
});
