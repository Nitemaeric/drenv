import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { Ruby } from "./ruby.ts";

describe("Ruby", () => {
  it("parses a snippet into the expected node types", async () => {
    const ruby = await Ruby.init();
    const tree = ruby.parse(
      [
        "class Player < Scene",
        "  def move(dx, dy)",
        "    @x += dx",
        "  end",
        "end",
        "",
      ].join("\n"),
    );

    const root = tree.rootNode;
    assertEquals(root.type, "program");

    const klass = root.namedChild(0)!;
    assertEquals(klass.type, "class");
    assertEquals(klass.childForFieldName("name")?.text, "Player");
    assertEquals(
      klass.childForFieldName("superclass")?.namedChild(0)?.text,
      "Scene",
    );

    const method = klass.childForFieldName("body")!.namedChild(0)!;
    assertEquals(method.type, "method");
    assertEquals(method.childForFieldName("name")?.text, "move");

    const params = method.childForFieldName("parameters")!;
    assertEquals(params.type, "method_parameters");
    assertEquals(params.namedChildCount, 2);
    assertEquals(params.namedChild(0)!.type, "identifier");
  });

  it("marks malformed input with an ERROR node", async () => {
    const ruby = await Ruby.init();
    const tree = ruby.parse("def broken(\n");
    assertEquals(tree.rootNode.hasError, true);
  });
});
