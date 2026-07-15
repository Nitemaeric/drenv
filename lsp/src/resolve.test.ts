import { beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

import { type Node, Ruby } from "./ruby.ts";
import { Workspace } from "./workspace.ts";
import { Resolver } from "./resolve.ts";
import type { Def } from "./types.ts";

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

// Identity lookup: methodsOf returns the same Def objects stored in the index.
const nameOfDef = (ws: Workspace, def: Def) => {
  for (const [name, locs] of ws.defs) if (locs.includes(def)) return name;
  return null;
};

// First call whose method name is `method`, returning its receiver node.
const receiverOf = (ws: Workspace, u: string, method: string): Node => {
  let found: Node | null = null;
  const walk = (n: Node) => {
    if (found) return;
    if (n.type === "call" && n.childForFieldName("method")?.text === method) {
      found = n.childForFieldName("receiver");
      return;
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)!);
  };
  walk(ws.fileTree(u)!.rootNode);
  return found!;
};

describe("Resolver.methodsOf", () => {
  const OBJ = [
    "module Game", // 0
    "  class Entity", // 1
    "    def base_move", // 2
    "    end", // 3
    "    def self.spawn", // 4
    "    end", // 5
    "  end", // 6
    "  class Player < Entity", // 7
    "    def dash", // 8
    "    end", // 9
    "    def self.build", // 10
    "    end", // 11
    "  end", // 12
    "end", // 13
  ].join("\n");

  it("walks the superclass chain, nearest class first", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, OBJ);
    const r = new Resolver(ws);
    assertEquals(
      r.methodsOf("Game::Player").map((d) => nameOfDef(ws, d)),
      ["dash", "base_move"],
    );
  });

  it("returns singleton methods separately, chain included", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, OBJ);
    const r = new Resolver(ws);
    assertEquals(
      r.methodsOf("Game::Player", { singleton: true }).map((d) =>
        nameOfDef(ws, d)
      ),
      ["build", "spawn"],
    );
  });

  it("is cycle-safe when superclasses reference each other", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      "class A < B\n  def a\n  end\nend\nclass B < A\n  def b\n  end\nend\n",
    );
    const r = new Resolver(ws);
    // Terminates; visits each class once.
    assertEquals(r.methodsOf("A").map((d) => nameOfDef(ws, d)).sort(), [
      "a",
      "b",
    ]);
  });

  it("returns nothing for an unknown class", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "class A\nend\n");
    assertEquals(new Resolver(ws).methodsOf("Nope"), []);
  });

  it("resolves an unqualified superclass from the subclass's namespace", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "module Game", // 0
        "  class Entity", // 1
        "    def base_move", // 2
        "    end", // 3
        "  end", // 4
        "  module Ui", // 5
        "    class Widget < Entity", // 6
        "      def draw", // 7
        "      end", // 8
        "    end", // 9
        "  end", // 10
        "end", // 11
      ].join("\n"),
    );
    const r = new Resolver(ws);
    // `Entity` is written bare inside Game::Ui but lives at Game::Entity;
    // #superclassOf must resolve it from the subclass's enclosing namespace.
    assertEquals(
      r.methodsOf("Game::Ui::Widget").map((d) => nameOfDef(ws, d)),
      ["draw", "base_move"],
    );
  });

  it("mixes in an included module's instance methods (include)", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      "file:///m/mods.rb",
      "module Movable\n  def move\n  end\nend\n",
    );
    ws.indexFile(
      uri,
      "class Base\n  def base_m\n  end\nend\n" +
        "class Entity < Base\n  include Movable\n  def tick\n  end\nend\n",
    );
    const r = new Resolver(ws);
    assertEquals(r.ancestors("Entity"), ["Entity", "Movable", "Base"]);
    assertEquals(
      r.methodsOf("Entity").map((d) => nameOfDef(ws, d)),
      ["tick", "move", "base_m"],
    );
  });

  it("resolves an included module by the class body's lexical scope", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "module Game",
        "  module Movable",
        "    def move",
        "    end",
        "  end",
        "  class Entity",
        "    include Movable", // bare `Movable` -> Game::Movable
        "    def tick",
        "    end",
        "  end",
        "end",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    assertEquals(r.ancestors("Game::Entity"), [
      "Game::Entity",
      "Game::Movable",
    ]);
  });

  it("unions includes across files that reopen the class", () => {
    const ws = new Workspace(ruby);
    ws.indexFile("file:///m/a.rb", "module A\n  def a\n  end\nend\n");
    ws.indexFile("file:///m/b.rb", "module B\n  def b\n  end\nend\n");
    ws.indexFile("file:///m/c1.rb", "class C\n  include A\nend\n");
    ws.indexFile("file:///m/c2.rb", "class C\n  include B\nend\n");
    const r = new Resolver(ws);
    assertEquals(r.ancestors("C").sort(), ["A", "B", "C"]);
  });

  it("adds an extended module's instance methods as singleton methods (extend)", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      "file:///m/s.rb",
      "module Serializable\n  def to_h\n  end\nend\n",
    );
    ws.indexFile(
      uri,
      "class Registry\n  extend Serializable\n  def self.reset\n  end\nend\n",
    );
    const r = new Resolver(ws);
    assertEquals(
      r.methodsOf("Registry", { singleton: true }).map((d) => nameOfDef(ws, d)),
      ["reset", "to_h"],
    );
    // extend does not touch the instance side.
    assertEquals(r.methodsOf("Registry"), []);
  });
});

describe("Resolver.receiverType — literal (rule 1)", () => {
  const cases: [string, string, string][] = [
    ["a = []", "a.each", "Array"],
    ["a = {}", "a.each", "Hash"],
    ["a = ''", "a.each", "String"],
    ["a = 5", "a.each", "Numeric"],
    ["a = 1.5", "a.each", "Numeric"],
    ["a = :sym", "a.each", "Symbol"],
  ];
  for (const [assign, use, cls] of cases) {
    it(`${assign} -> ${cls}`, () => {
      const ws = new Workspace(ruby);
      ws.indexFile(uri, `def m\n  ${assign}\n  ${use}\nend\n`);
      const r = new Resolver(ws);
      assertEquals(r.receiverType(uri, receiverOf(ws, uri, "each")), {
        class: cls,
        source: "literal",
      });
    });
  }

  it("uses the nearest preceding assignment on reassignment", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  a = []\n  a = {}\n  a.each\nend\n");
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "each")), {
      class: "Hash",
      source: "literal",
    });
  });

  it("returns null for an unassigned local", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  a.each\nend\n");
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "each")), null);
  });

  it("exposes a hash literal's symbol keys (DragonRuby dot-access)", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      'def m\n  a = { x: 1, :y => 2, "s" => 3 }\n  a.each\nend\n',
    );
    const r = new Resolver(ws);
    const g = r.receiverType(uri, receiverOf(ws, uri, "each"));
    assertEquals(g?.class, "Hash");
    // Symbol keys only; the string key "s" is not dot-accessible.
    assertEquals(g?.keys, ["x", "y"]);
  });

  it("types a local even when a dangling dot collapsed the enclosing def", () => {
    // `h.` before `end` parses as `h.end`, eating the keyword and turning the
    // def into an ERROR node — the assignment still resolves via the fallback.
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  h = { k: 1 }\n  h.\nend\n");
    const r = new Resolver(ws);
    const dot = receiverOf(ws, uri, "end"); // the mis-parsed `h.end` receiver
    assertEquals(r.receiverType(uri, dot)?.class, "Hash");
    assertEquals(r.receiverType(uri, dot)?.keys, ["k"]);
  });
});

describe("Resolver.receiverType — new (rule 2)", () => {
  it("types `Klass.new` to the workspace class", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "module App",
        "  class Anim",
        "  end",
        "  class S",
        "    def go",
        "      x = Anim.new",
        "      x.play",
        "    end",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "play")), {
      class: "App::Anim",
      source: "new",
    });
  });

  it("returns null when the class isn't in the workspace", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  x = Unknown.new\n  x.play\nend\n");
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "play")), null);
  });
});

describe("Resolver.receiverType — ivar (rule 3)", () => {
  it("types a consistently-assigned @ivar across the class body", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "class C",
        "  def setup",
        "    @items = []",
        "  end",
        "  def run",
        "    @items.each",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "each")), {
      class: "Array",
      source: "ivar",
    });
  });

  it("returns null when @ivar assignments conflict", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "class C",
        "  def a",
        "    @v = []",
        "  end",
        "  def b",
        "    @v = {}",
        "  end",
        "  def c",
        "    @v.each",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "each")), null);
  });

  it("returns null when any @ivar assignment is untypeable", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "class C",
        "  def a",
        "    @v = []",
        "  end",
        "  def b",
        "    @v = build_it",
        "  end",
        "  def c",
        "    @v.each",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "each")), null);
  });

  it("types an @ivar even when a dangling dot collapsed the class", () => {
    // `@players.` before `end` parses as `@players.end`, eating the keyword so
    // the class becomes an ERROR node with no `class` ancestor. The assignment
    // still parses; the statement-scope fallback finds it.
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      "class Game\n  def setup\n    @players = [{ n: 1 }]\n    @players.\n  end\nend\n",
    );
    const r = new Resolver(ws);
    const dot = receiverOf(ws, uri, "end"); // the mis-parsed `@players.end`
    assertEquals(r.receiverType(uri, dot)?.class, "Array");
  });
});

describe("Resolver.receiverType — return dispatch (rule 4)", () => {
  const FRAME = [
    "module App", // 0
    "  class UI", // 1
    "    def view", // 2
    "    end", // 3
    "  end", // 4
    "  class Camera", // 5
    "    # @return [UI]", // 6
    "    def ui", // 7
    "    end", // 8
    "  end", // 9
    "  class Scene", // 10
    "    def tick", // 11
    "      camera.ui.view", // 12
    "    end", // 13
    "  end", // 14
    "end", // 15
  ].join("\n");

  it("types `recv.meth` via a uniquely-named method's @return", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, FRAME);
    const r = new Resolver(ws);
    // receiver of `.view` is the `camera.ui` call.
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "view")), {
      class: "App::UI",
      source: "return",
    });
  });

  it("does not dispatch when two methods share the name", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "module App",
        "  class UI",
        "    def view",
        "    end",
        "  end",
        "  class A",
        "    # @return [UI]",
        "    def ui",
        "    end",
        "  end",
        "  class B",
        "    # @return [UI]",
        "    def ui",
        "    end",
        "  end",
        "  class Scene",
        "    def tick",
        "      camera.ui.view",
        "    end",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "view")), null);
  });

  it("does not dispatch a two-hop chain (nested return typing is barred)", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "module App",
        "  class X",
        "    def leaf",
        "    end",
        "  end",
        "  class Y",
        "    def leaf",
        "    end",
        "  end",
        "  class S",
        "    def go",
        "      a.mid.leaf",
        "    end",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    // `leaf` is ambiguous, and typing `a.mid` would need a second return hop.
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "leaf")), null);
  });

  it("disambiguates a shared name via the receiver's own type", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "module App",
        "  class UI",
        "    def view",
        "    end",
        "  end",
        "  class Camera",
        "    # @return [UI]",
        "    def ui",
        "    end",
        "  end",
        "  class Other",
        "    # @return [Nope]",
        "    def ui",
        "    end",
        "  end",
        "  class Scene",
        "    def tick",
        "      cam = Camera.new",
        "      cam.ui.view",
        "    end",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    const r = new Resolver(ws);
    // `ui` is ambiguous globally, but `cam` types to Camera (rule 2), which
    // owns exactly one `ui`.
    assertEquals(r.receiverType(uri, receiverOf(ws, uri, "view")), {
      class: "App::UI",
      source: "return",
    });
  });
});

describe("Resolver.sameMethodLiteral", () => {
  const methodNode = (ws: Workspace, u: string): Node => {
    let found: Node | null = null;
    const walk = (n: Node) => {
      if (found) return;
      if (n.type === "method") {
        found = n;
        return;
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)!);
    };
    walk(ws.fileTree(u)!.rootNode);
    return found!;
  };

  it("returns the single unreassigned literal hash", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  p = { x: 0, y: 0 }\n  use(p)\nend\n");
    const r = new Resolver(ws);
    const rhs = r.sameMethodLiteral(methodNode(ws, uri), "p");
    assert(rhs);
    assertEquals(rhs.type, "hash");
  });

  it("returns null when the local is reassigned", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  p = { x: 0 }\n  p = { y: 1 }\n  use(p)\nend\n");
    const r = new Resolver(ws);
    assertEquals(r.sameMethodLiteral(methodNode(ws, uri), "p"), null);
  });

  it("returns null on element-assignment mutation", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  p = { x: 0 }\n  p[:y] = 1\n  use(p)\nend\n");
    const r = new Resolver(ws);
    assertEquals(r.sameMethodLiteral(methodNode(ws, uri), "p"), null);
  });

  it("returns null on a bang or store mutating call", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  p = { x: 0 }\n  p.merge!(q)\nend\n");
    const r1 = new Resolver(ws);
    assertEquals(r1.sameMethodLiteral(methodNode(ws, uri), "p"), null);

    ws.indexFile(uri, "def m\n  p = { x: 0 }\n  p.store(:y, 1)\nend\n");
    const r2 = new Resolver(ws);
    assertEquals(r2.sameMethodLiteral(methodNode(ws, uri), "p"), null);
  });

  it("returns null for a non-literal RHS", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "def m\n  p = build\n  use(p)\nend\n");
    const r = new Resolver(ws);
    assertEquals(r.sameMethodLiteral(methodNode(ws, uri), "p"), null);
  });
});
