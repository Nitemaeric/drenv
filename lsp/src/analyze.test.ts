import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { Ruby } from "./ruby.ts";
import {
  extractParams,
  GEOM_ATTRS,
  nodeRange,
  renderSignature,
} from "./analyze.ts";
import type { Node } from "./ruby.ts";

const firstMethod = (ruby: Ruby, src: string): Node => {
  const root = ruby.parse(src).rootNode;
  const find = (node: Node): Node | null => {
    if (node.type === "method") return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const hit = find(node.namedChild(i)!);
      if (hit) return hit;
    }
    return null;
  };
  return find(root)!;
};

describe("extractParams", () => {
  it("classifies every parameter kind", async () => {
    const ruby = await Ruby.init();
    const method = firstMethod(
      ruby,
      "def f(a, b = 1, key:, opt: 2, *rest)\nend\n",
    );
    const params = extractParams(method);
    assertEquals(
      params.map((p) => [p.name, p.kind]),
      [
        ["a", "required"],
        ["b", "optional"],
        ["key", "keyword"],
        ["opt", "keyword_optional"],
        ["rest", "rest"],
      ],
    );
  });

  it("returns [] for a method with no parameter list", async () => {
    const ruby = await Ruby.init();
    assertEquals(extractParams(firstMethod(ruby, "def f\nend\n")), []);
  });

  it("keeps the source label of each parameter", async () => {
    const ruby = await Ruby.init();
    const params = extractParams(
      firstMethod(ruby, "def f(a, b = 1, key:)\nend\n"),
    );
    assertEquals(params.map((p) => p.label), ["a", "b = 1", "key:"]);
  });

  it("derives a duck shape from geometric attrs read off a param", async () => {
    const ruby = await Ruby.init();
    const method = firstMethod(
      ruby,
      [
        "def intersect(rect)",
        "  a = rect.x",
        "  b = rect.y",
        "  c = rect.w",
        "end",
        "",
      ].join("\n"),
    );
    const [rect] = extractParams(method);
    assertEquals(rect.shape, ["w", "x", "y"]);
  });

  it("ignores non-geometric reads and attrs with arguments", async () => {
    const ruby = await Ruby.init();
    const method = firstMethod(
      ruby,
      [
        "def f(p)",
        "  p.merge(other)",
        "  p.foo",
        "  p.x(1)",
        "end",
        "",
      ].join("\n"),
    );
    assertEquals(extractParams(method)[0].shape, undefined);
  });

  it("drops the shape when the parameter is reassigned", async () => {
    const ruby = await Ruby.init();
    const method = firstMethod(
      ruby,
      [
        "def f(p)",
        "  x = p.x",
        "  p = something",
        "end",
        "",
      ].join("\n"),
    );
    assertEquals(extractParams(method)[0].shape, undefined);
  });
});

describe("renderSignature", () => {
  it("joins parameter labels", async () => {
    const ruby = await Ruby.init();
    const params = extractParams(
      firstMethod(ruby, "def f(a, b = 1, key:)\nend\n"),
    );
    assertEquals(renderSignature("f", params), "f(a, b = 1, key:)");
  });

  it("renders an empty parameter list", () => {
    assertEquals(renderSignature("tick", []), "tick()");
  });
});

describe("nodeRange", () => {
  it("maps tree-sitter positions to an LSP range", async () => {
    const ruby = await Ruby.init();
    const method = firstMethod(ruby, "def f(a)\nend\n");
    const name = method.childForFieldName("name")!;
    assertEquals(nodeRange(name), {
      start: { line: 0, character: 4 },
      end: { line: 0, character: 5 },
    });
  });
});

describe("GEOM_ATTRS", () => {
  it("whitelists the geometric attributes", () => {
    assertEquals(GEOM_ATTRS.has("x"), true);
    assertEquals(GEOM_ATTRS.has("anchor_y"), true);
    assertEquals(GEOM_ATTRS.has("merge"), false);
  });
});
