import { beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

import { Ruby } from "./ruby.ts";
import type { Node } from "./ruby.ts";
import { Workspace } from "./workspace.ts";
import {
  arrayPrimitivesRule,
  bulkConcatRule,
  mutationDuringIteration,
  recursionRule,
  type SeverityAt,
  tickReachability,
  unusedMapRule,
} from "./perf.ts";

type Diag = { message: string; severity: number; code?: string };
type Rule = (node: Node, out: unknown[], sev: SeverityAt) => void;

let ruby: Ruby;
beforeAll(async () => {
  ruby = await Ruby.init();
});

const three: SeverityAt = () => 3;

// Runs a rule over every node of `src`, returning the collected diagnostics.
const runRule = (rule: Rule, src: string, sev: SeverityAt = three): Diag[] => {
  const out: unknown[] = [];
  const root = ruby.parse(src).rootNode;
  const walk = (n: Node) => {
    rule(n, out, sev);
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)!);
  };
  walk(root);
  return out as Diag[];
};

const codes = (diags: Diag[]) => diags.map((d) => d.code);

const methodNode = (root: Node, name: string): Node => {
  let found: Node | null = null;
  const walk = (n: Node) => {
    if (
      (n.type === "method" || n.type === "singleton_method") &&
      n.childForFieldName("name")?.text === name
    ) {
      found = n;
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)!);
  };
  walk(root);
  if (!found) throw new Error(`no method ${name}`);
  return found;
};

describe("perf — array primitives should be hashes", () => {
  it("fires on an array literal pushed to a render layer", () => {
    const diags = runRule(
      arrayPrimitivesRule,
      "args.outputs.sprites << [1, 2]\n",
    );
    assertEquals(codes(diags), ["array-primitives"]);
    assert(diags[0].message.includes("outputs.sprites << [ … ]"));
    assertEquals(diags[0].severity, 3);
  });

  it("stays silent on a hash literal (the fast form)", () => {
    assertEquals(
      runRule(arrayPrimitivesRule, "args.outputs.sprites << { x: 1 }\n"),
      [],
    );
  });

  it("stays silent on background_color / screenshots (not append layers)", () => {
    assertEquals(
      runRule(arrayPrimitivesRule, "args.outputs.background_color << [1]\n"),
      [],
    );
  });

  it("stays silent when the receiver is not an outputs access", () => {
    assertEquals(runRule(arrayPrimitivesRule, "thing.sprites << [1]\n"), []);
  });

  it("handles static_ layer variants", () => {
    assertEquals(
      codes(runRule(
        arrayPrimitivesRule,
        "args.outputs.static_sprites << [1]\n",
      )),
      ["array-primitives"],
    );
  });
});

describe("perf — bulk concatenation inside iteration", () => {
  it("fires on `<<` to an outputs layer inside an each block", () => {
    const src = "xs.each do |x|\n  args.outputs.sprites << x\nend\n";
    assertEquals(codes(runRule(bulkConcatRule, src)), ["bulk-concatenation"]);
  });

  it("fires on `.concat` to an outputs layer inside a map block", () => {
    const src = "xs.map { |x| args.outputs.labels.concat x }\n";
    assertEquals(codes(runRule(bulkConcatRule, src)), ["bulk-concatenation"]);
  });

  it("stays silent outside any iteration block", () => {
    assertEquals(runRule(bulkConcatRule, "args.outputs.sprites << x\n"), []);
  });

  it("stays silent for a non-outputs append inside iteration", () => {
    assertEquals(
      runRule(bulkConcatRule, "xs.each { |x| acc << x }\n"),
      [],
    );
  });
});

describe("perf — recursion notice", () => {
  it("fires on the bare-identifier zero-arg self-call", () => {
    const diags = runRule(recursionRule, "def f n\n  f\nend\n");
    assertEquals(codes(diags), ["recursion"]);
    assert(diags[0].message.includes("`f` calls itself"));
  });

  it("fires on a receiver-less call self-call", () => {
    assertEquals(codes(runRule(recursionRule, "def f n\n  f(n - 1)\nend\n")), [
      "recursion",
    ]);
  });

  it("fires on a `self.` self-call", () => {
    assertEquals(codes(runRule(recursionRule, "def f\n  self.f\nend\n")), [
      "recursion",
    ]);
  });

  it("does not fire when the name is shadowed by a local", () => {
    // `f` is a local variable here, not a self-call.
    assertEquals(runRule(recursionRule, "def f\n  f = 1\n  f\nend\n"), []);
  });

  it("does not fire on a non-recursive method", () => {
    assertEquals(runRule(recursionRule, "def f\n  g\nend\n"), []);
  });
});

describe("perf — unused non-final .map", () => {
  it("fires on a block .map that is not the last statement", () => {
    const diags = runRule(
      unusedMapRule,
      "def a\n  xs.map { |x| x }\n  y = 1\nend\n",
    );
    assertEquals(codes(diags), ["unused-map"]);
  });

  it("does not fire on a trailing .map (its result is the return value)", () => {
    assertEquals(
      runRule(unusedMapRule, "def a\n  xs.map { |x| x }\nend\n"),
      [],
    );
  });

  it("does not fire when the result is assigned", () => {
    assertEquals(
      runRule(unusedMapRule, "def a\n  y = xs.map { |x| x }\n  z = 1\nend\n"),
      [],
    );
  });

  it("does not fire on a block-less .map", () => {
    assertEquals(
      runRule(unusedMapRule, "def a\n  xs.map(&:to_s)\n  y = 1\nend\n"),
      [],
    );
  });

  it("does not fire when the .map is an argument", () => {
    assertEquals(
      runRule(unusedMapRule, "def a\n  foo(xs.map { |x| x })\n  y = 1\nend\n"),
      [],
    );
  });
});

describe("perf — tick reachability gate", () => {
  const SRC = [
    "def tick args",
    "  hot args",
    "end",
    "",
    "def hot args",
    "end",
    "",
    "def cold args",
    "  hot args",
    "end",
    "",
    "def orphan args",
    "end",
    "",
    "map_at_top { |x| x }",
    "y = 1",
  ].join("\n");

  const gate = (): SeverityAt => {
    const ws = new Workspace(ruby);
    ws.indexFile("file:///t.rb", SRC);
    return tickReachability(ws);
  };

  it("Information for a method reachable from tick", () => {
    const sev = gate();
    const root = ws().rootNode;
    assertEquals(sev(methodNode(root, "hot")), 3);
    assertEquals(sev(methodNode(root, "tick")), 3);
  });

  it("Hint for a method with callers but no tick path", () => {
    // `cold` is called by nothing; but it IS a caller of `hot`. `cold` itself
    // has in-degree 0 → Information. Build a case with a genuine caller instead.
    const src = [
      "def tick args",
      "  entry args",
      "end",
      "def entry args",
      "  helper args",
      "end",
      "def helper args",
      "end",
      "def side args",
      "  lonely args",
      "end",
      "def lonely args",
      "end",
    ].join("\n");
    const w = new Workspace(ruby);
    w.indexFile("file:///g.rb", src);
    const sev = tickReachability(w);
    const root = w.fileTree("file:///g.rb")!.rootNode;
    // helper is reachable tick→entry→helper
    assertEquals(sev(methodNode(root, "helper")), 3);
    // lonely has a caller (side) but no tick path → Hint
    assertEquals(sev(methodNode(root, "lonely")), 4);
    // side has no callers → Information
    assertEquals(sev(methodNode(root, "side")), 3);
  });

  it("Information for a method with no known callers", () => {
    const sev = gate();
    assertEquals(sev(methodNode(ws().rootNode, "orphan")), 3);
  });

  it("Information for a top-level firing (outside any method)", () => {
    const sev = gate();
    const root = ws().rootNode;
    // the top-level `y = 1` assignment is outside any method
    let asg: Node | null = null;
    const walk = (n: Node) => {
      if (n.type === "assignment" && n.parent?.type === "program") asg = n;
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)!);
    };
    walk(root);
    assertEquals(sev(asg!), 3);
  });

  let cachedWs: Workspace | null = null;
  const ws = () => {
    if (!cachedWs) {
      cachedWs = new Workspace(ruby);
      cachedWs.indexFile("file:///t.rb", SRC);
    }
    return cachedWs.fileTree("file:///t.rb")!;
  };
});

describe("perf — mutationDuringIteration (moved verbatim)", () => {
  it("still flags mutation of the iterated receiver", () => {
    const out: unknown[] = [];
    const root =
      ruby.parse("list.each do |i|\n  list.delete i\nend\n").rootNode;
    const walk = (n: Node) => {
      mutationDuringIteration(n, out);
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)!);
    };
    walk(root);
    const diags = out as Diag[];
    assertEquals(codes(diags), ["array-manipulation"]);
    assertEquals(diags[0].severity, 3);
  });
});
