import { beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

import { Ruby } from "./ruby.ts";
import { Workspace } from "./workspace.ts";
import { Resolver } from "./resolve.ts";

let ruby: Ruby;
beforeAll(async () => {
  ruby = await Ruby.init();
});

const uri = "file:///workspace/a.rb";

const FIXTURE = [
  "module Game", // 0
  "  class Player < Entity", // 1
  "    # Moves the player.", // 2
  "    def move(dx, dy)", // 3
  "      speed = compute", // 4
  "      [1, 2].each do |item|", // 5
  "        dx.clamp(item, speed)", // 6
  "      end", // 7
  "    end", // 8
  "", // 9
  "    def compute", // 10
  "      42", // 11
  "    end", // 12
  "  end", // 13
  "", // 14
  "  class Entity", // 15
  "    def compute", // 16
  "      0", // 17
  "    end", // 18
  "    def render", // 19
  "    end", // 20
  "  end", // 21
  "end", // 22
].join("\n");

/** Position just inside the first occurrence of `needle` on `line`. */
const at = (text: string, line: number, needle: string) => {
  const character = text.split("\n")[line].indexOf(needle) + 1;
  return { line, character };
};

const setup = () => {
  const ws = new Workspace(ruby);
  ws.indexFile(uri, FIXTURE);
  return { ws, resolver: new Resolver(ws) };
};

describe("Resolver.wordAt", () => {
  it("reads the identifier under the cursor, including ?/! suffixes", () => {
    const ws = new Workspace(ruby);
    const u = "file:///w/x.rb";
    ws.indexFile(u, "  found? = bar!\n");
    const r = new Resolver(ws);
    assertEquals(r.wordAt(u, { line: 0, character: 4 }), "found?");
    assertEquals(r.wordAt(u, { line: 0, character: 11 }), "bar!");
  });

  it("returns null in whitespace", () => {
    const ws = new Workspace(ruby);
    const u = "file:///w/x.rb";
    ws.indexFile(u, "  a + b\n");
    const r = new Resolver(ws);
    assertEquals(r.wordAt(u, { line: 0, character: 0 }), null);
  });
});

describe("Resolver.enclosingNamespace", () => {
  it("joins the enclosing class/module names", () => {
    const { ws, resolver } = setup();
    const node = ws.fileTree(uri)!.rootNode.descendantForPosition({
      row: 4,
      column: 6,
    })!;
    assertEquals(resolver.enclosingNamespace(node), "Game::Player");
  });
});

describe("Resolver.resolveLocal", () => {
  it("resolves a method parameter", () => {
    const { resolver } = setup();
    const hit = resolver.resolveLocal(uri, at(FIXTURE, 6, "dx"), "dx");
    assert(hit);
    assertEquals(hit.role, "parameter");
    assertEquals(hit.methodLabel, "Game::Player#move");
    // The hit points at the parameter's definition, not the usage.
    assertEquals(hit.node.startPosition.row, 3);
  });

  it("resolves a block parameter", () => {
    const { resolver } = setup();
    const hit = resolver.resolveLocal(uri, at(FIXTURE, 6, "item"), "item");
    assert(hit);
    assertEquals(hit.role, "block parameter");
  });

  it("resolves a local variable", () => {
    const { resolver } = setup();
    const hit = resolver.resolveLocal(uri, at(FIXTURE, 6, "speed"), "speed");
    assert(hit);
    assertEquals(hit.role, "local variable");
  });

  it("returns null for the method name of a call", () => {
    const { resolver } = setup();
    assertEquals(
      resolver.resolveLocal(uri, at(FIXTURE, 6, "clamp"), "clamp"),
      null,
    );
  });

  it("returns null outside any method", () => {
    const { resolver } = setup();
    assertEquals(
      resolver.resolveLocal(uri, at(FIXTURE, 1, "Player"), "Player"),
      null,
    );
  });
});

describe("Resolver.namespaceIndex", () => {
  it("indexes qualified classes/modules, skipping methods, first-wins", () => {
    const { resolver } = setup();
    const ns = resolver.namespaceIndex();
    assert(ns.has("Game"));
    assert(ns.has("Game::Player"));
    assert(ns.has("Game::Entity"));
    // Methods are excluded.
    assert(!ns.has("Game::Player::move"));
    assert(!ns.has("Game::Player::compute"));
    assertEquals(ns.get("Game::Player")!.superclass, "Entity");
  });

  it("caches against the workspace generation", () => {
    const { ws, resolver } = setup();
    const first = resolver.namespaceIndex();
    assert(first === resolver.namespaceIndex());
    ws.indexFile(uri, "class Fresh\nend\n");
    const rebuilt = resolver.namespaceIndex();
    assert(rebuilt !== first);
    assert(rebuilt.has("Fresh"));
    assert(!rebuilt.has("Game"));
  });
});

describe("Resolver.resolveConstName / resolveConst", () => {
  it("walks outward from the container namespace", () => {
    const { resolver } = setup();
    assertEquals(
      resolver.resolveConstName("Entity", "Game::Player"),
      "Game::Entity",
    );
    assertEquals(resolver.resolveConstName("Player", "Game"), "Game::Player");
  });

  it("returns null for an unknown constant", () => {
    const { resolver } = setup();
    assertEquals(resolver.resolveConstName("Nope", "Game"), null);
    assertEquals(resolver.resolveConst("Nope", "Game"), null);
  });

  it("resolveConst returns the matching Def", () => {
    const { resolver } = setup();
    const def = resolver.resolveConst("Entity", "Game::Player");
    assert(def);
    assertEquals(def.kind, "class");
    assertEquals(def.container, "Game");
  });
});

describe("Resolver.contextCandidates", () => {
  it("prefers the enclosing class", () => {
    const { ws, resolver } = setup();
    const found = ws.defs.get("compute")!;
    assertEquals(found.length, 2);
    const hits = resolver.contextCandidates(
      uri,
      at(FIXTURE, 4, "compute"),
      found,
    )!;
    assertEquals(hits.length, 1);
    assertEquals(hits[0].container, "Game::Player");
  });

  it("walks the superclass chain when the enclosing class misses", () => {
    const { ws, resolver } = setup();
    const found = ws.defs.get("render")!;
    // render is defined only in Entity; call site is inside Player.
    const hits = resolver.contextCandidates(
      uri,
      at(FIXTURE, 6, "dx"),
      found,
    )!;
    assertEquals(hits.length, 1);
    assertEquals(hits[0].container, "Game::Entity");
  });

  it("falls back to same-file defs at top level", () => {
    const ws = new Workspace(ruby);
    const a = "file:///w/a.rb";
    const b = "file:///w/b.rb";
    ws.indexFile(a, "def helper\nend\nhelper\n");
    ws.indexFile(b, "def helper\nend\n");
    const resolver = new Resolver(ws);
    const found = ws.defs.get("helper")!;
    assertEquals(found.length, 2);
    const hits = resolver.contextCandidates(
      a,
      { line: 2, character: 0 },
      found,
    )!;
    assertEquals(hits.length, 1);
    assertEquals(hits[0].uri, a);
  });

  it("returns null when no tier hits", () => {
    const ws = new Workspace(ruby);
    const a = "file:///w/a.rb";
    const b = "file:///w/b.rb";
    ws.indexFile(a, "puts 1\n");
    ws.indexFile(b, "def helper\nend\n");
    const resolver = new Resolver(ws);
    const found = ws.defs.get("helper")!;
    assertEquals(
      resolver.contextCandidates(a, { line: 0, character: 0 }, found),
      null,
    );
  });
});
