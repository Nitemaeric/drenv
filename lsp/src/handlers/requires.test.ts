import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";

import { Ruby } from "../ruby.ts";
import { Workspace } from "../workspace.ts";
import { Resolver } from "../resolve.ts";
import { YardRenderer } from "../yard.ts";
import { EngineIndex } from "../engine.ts";
import type { Ctx } from "./ctx.ts";
import { completion } from "./completion.ts";
import { definition } from "./navigation.ts";

let base: string;
let ctx: Ctx;
const uri = (path: string) => toFileUrl(join(base, path)).href;

const MAIN = [
  'require "app/player.rb"', // 0
  "require 'lib/util'", // 1
  'require_relative "enemy"', // 2
  'require "app/', // 3
  "",
].join("\n");

beforeAll(async () => {
  const ruby = await Ruby.init();
  base = await Deno.makeTempDir({ prefix: "drenv-requires-" });
  const engine = await EngineIndex.build(ruby, join(base, "no-engine"));
  const ws = new Workspace(ruby);
  ws.indexFile(uri("mygame/app/main.rb"), MAIN);
  ws.indexFile(uri("mygame/app/player.rb"), "class Player\nend\n");
  ws.indexFile(uri("mygame/app/enemy.rb"), "class Enemy\nend\n");
  ws.indexFile(uri("mygame/lib/util.rb"), "module Util\nend\n");
  const resolver = new Resolver(ws);
  ctx = { ws, resolver, yard: new YardRenderer(resolver), engine };
});

afterAll(async () => {
  await Deno.remove(base, { recursive: true }).catch(() => {});
});

const target = (line: number, character: number) =>
  definition(ctx, uri("mygame/app/main.rb"), { line, character }).map((l) =>
    l.uri
  );

describe("require paths", () => {
  it("jumps from a require to the file, relative to the game directory", () => {
    assertEquals(target(0, 12), [uri("mygame/app/player.rb")]);
    assertEquals(target(1, 12), [uri("mygame/lib/util.rb")]); // `.rb` implied
  });

  it("resolves require_relative against the requiring file", () => {
    assertEquals(target(2, 20), [uri("mygame/app/enemy.rb")]);
  });

  it("completes paths inside the require string", () => {
    const items = completion(ctx, uri("mygame/app/main.rb"), {
      line: 3,
      character: 13,
    }) as { label: string; textEdit: { range: { start: unknown } } }[];
    assertEquals(
      items.map((i) => i.label).sort(),
      ["app/enemy.rb", "app/player.rb", "lib/util.rb"],
    );
    assertEquals(items[0].textEdit.range.start, { line: 3, character: 9 });
  });
});
