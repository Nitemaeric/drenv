import { describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";

import type { ConstResolver, Def } from "./types.ts";
import { YardRenderer } from "./yard.ts";

const def = (uri: string, line: number): Def => ({
  uri,
  range: { start: { line, character: 0 }, end: { line, character: 0 } },
  kind: "class",
});

/** Container-aware stub: resolves a path by walking `container` outward, the
 * way the real resolver does, but over a fixed map — no workspace needed. */
class StubResolver implements ConstResolver {
  #defs: Map<string, Def>;
  constructor(defs: Record<string, Def> = {}) {
    this.#defs = new Map(Object.entries(defs));
  }
  resolveConstName(path: string, container: string): string | null {
    const parts = container ? container.split("::") : [];
    for (let i = parts.length; i >= 0; i--) {
      const prefix = parts.slice(0, i).join("::");
      const key = prefix ? `${prefix}::${path}` : path;
      if (this.#defs.has(key)) return key;
    }
    return null;
  }
  resolveConst(path: string, container: string): Def | null {
    const key = this.resolveConstName(path, container);
    return key ? this.#defs.get(key)! : null;
  }
}

const anim = def("file:///animation.rb", 4); // → #L5

describe("YardRenderer.render — tags", () => {
  it("passes a plain non-YARD block through unchanged", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("Just a plain comment.\nSecond line."),
      "Just a plain comment.\nSecond line.",
    );
  });

  it("converts RDoc +code+ spans to backticks in prose", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("Uses +foo+ and +bar+ here."),
      "Uses `foo` and `bar` here.",
    );
  });

  it("renders @param bullets with linked and unlinked types", () => {
    const y = new YardRenderer(new StubResolver({ Animation: anim }));
    const out = y.render(
      "@param animation [Animation] the anim\n@param count [Integer] how many",
    );
    assertEquals(
      out,
      "**Parameters**\n" +
        "- `animation` ([`Animation`](file:///animation.rb#L5)) — the anim\n" +
        "- `count` (`Integer`) — how many",
    );
  });

  it("renders @return with a typed clause", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("@return [Boolean] whether it worked"),
      "**Returns** (`Boolean`) whether it worked",
    );
  });

  it("renders @yield, @yieldparam, and @yieldreturn together", () => {
    const y = new YardRenderer(new StubResolver({ Animation: anim }));
    const out = y.render(
      "@yield [frame] each frame\n" +
        "@yieldparam frame [Animation] the current frame\n" +
        "@yieldreturn [Boolean] whether to keep going",
    );
    assertEquals(
      out,
      "**Yields** (`frame`) each frame\n" +
        "- `frame` ([`Animation`](file:///animation.rb#L5)) — the current frame\n" +
        "**Yield returns** (`Boolean`) whether to keep going",
    );
  });

  it("renders @raise", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("@raise [ArgumentError] when the input is bad"),
      "**Raises** (`ArgumentError`) when the input is bad",
    );
  });

  it("renders @note and @deprecated as blockquotes", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("@note Watch out for +nil+"),
      "> **Note:** Watch out for `nil`",
    );
    assertEquals(
      y.render("@deprecated Use +replacement+ instead"),
      "> **Deprecated.** Use `replacement` instead",
    );
  });

  it("links a @see to a resolvable constant, plain-texts an unresolvable one", () => {
    const y = new YardRenderer(new StubResolver({ Animation: anim }));
    assertEquals(
      y.render("@see Animation for the shape"),
      "_See:_ [`Animation`](file:///animation.rb#L5) for the shape",
    );
    assertEquals(
      y.render("@see https://example.com/docs the guide"),
      "_See:_ https://example.com/docs the guide",
    );
  });

  it("italicises an unknown tag", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(y.render("@author Daniel Dye"), "_@author_ Daniel Dye");
  });

  it("emits @example as a fenced ruby block", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("@example\n  x = 1\n  y = x + 1"),
      "```ruby\nx = 1\ny = x + 1\n```",
    );
  });

  it("combines an intro with several sections in order", () => {
    const y = new YardRenderer(new StubResolver());
    const out = y.render(
      "Does a thing.\n@param n [Integer] a count\n@return [Boolean] ok?",
    );
    assertEquals(
      out,
      "Does a thing.\n\n" +
        "**Parameters**\n- `n` (`Integer`) — a count\n\n" +
        "**Returns** (`Boolean`) ok?",
    );
  });
});

describe("YardRenderer.render — indented continuations", () => {
  it("joins a @param continuation inline (no blockquote)", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("@param x [Integer] the value\n  with more detail"),
      "**Parameters**\n- `x` (`Integer`) — the value with more detail",
    );
  });

  it("joins a @note continuation as blockquote lines", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("@note First line\n  second line\n  third line"),
      "> **Note:** First line\n> second line\n> third line",
    );
  });

  it("ends a continuation at the next tag", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(
      y.render("@note careful\n  still the note\n@deprecated gone"),
      "> **Note:** careful\n> still the note\n\n> **Deprecated.** gone",
    );
  });
});

describe("YardRenderer.renderType", () => {
  it("links a resolvable constant and backticks a bare word", () => {
    const y = new YardRenderer(new StubResolver({ Animation: anim }));
    assertEquals(
      y.renderType("Animation", ""),
      "[`Animation`](file:///animation.rb#L5)",
    );
    assertEquals(y.renderType("nil", ""), "`nil`");
  });

  it("handles a compound type list, linking only resolvable members", () => {
    const y = new YardRenderer(new StubResolver({ Animation: anim }));
    assertEquals(
      y.renderType("Array<Numeric>, nil", ""),
      "`Array<Numeric>`, `nil`",
    );
    assertEquals(
      y.renderType("Animation, nil", ""),
      "[`Animation`](file:///animation.rb#L5), `nil`",
    );
  });

  it("resolves relative to the given container", () => {
    const y = new YardRenderer(
      new StubResolver({ "A::Thing": def("file:///a.rb", 9) }),
    );
    assertEquals(y.renderType("Thing", "A"), "[`Thing`](file:///a.rb#L10)");
    assertEquals(y.renderType("Thing", "B"), "`Thing`");
  });
});

describe("YardRenderer.inlineMd", () => {
  it("converts +code+ to backticks", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(y.inlineMd("+a+ then +b c+"), "`a` then `b c`");
  });

  it("leaves text with no RDoc markup alone", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(y.inlineMd("plain 1 + 2 text"), "plain 1 + 2 text");
  });
});

describe("YardRenderer cache", () => {
  it("keys on container: the same raw resolves differently per namespace", () => {
    const y = new YardRenderer(
      new StubResolver({
        "A::Thing": def("file:///a.rb", 4),
        "B::Thing": def("file:///b.rb", 9),
      }),
    );
    const raw = "@return [Thing] the result";
    const inA = y.render(raw, "A");
    const inB = y.render(raw, "B");
    assertNotEquals(inA, inB);
    assertStringIncludes(inA, "file:///a.rb#L5");
    assertStringIncludes(inB, "file:///b.rb#L10");
    // Re-render hits the cache and stays stable per container.
    assertEquals(y.render(raw, "A"), inA);
    assertEquals(y.render(raw, "B"), inB);
  });

  it("clear() drops cached renders", () => {
    const y = new YardRenderer(new StubResolver());
    assertEquals(y.render("plain"), "plain");
    y.clear();
    assertEquals(y.render("plain"), "plain");
  });
});
