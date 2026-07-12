import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

import { Ruby } from "../ruby.ts";
import {
  classMethodBullets,
  codeFences,
  docOnlySignature,
  firstProse,
  leadingIdent,
  memberNames,
  methodHeadingDocs,
  parseHeadings,
} from "./md.ts";

describe("md.leadingIdent", () => {
  it("takes the leading identifier, discarding signature/arg text", () => {
    assertEquals(leadingIdent("rect(offset: nil)"), "rect");
    assertEquals(leadingIdent("inside_rect? rect"), "inside_rect?");
    assertEquals(leadingIdent("map!"), "map!");
  });

  it("rejects tokens that don't start with a lowercase identifier", () => {
    assertEquals(leadingIdent("Array"), null);
    assertEquals(leadingIdent("(left|right)_analog"), null);
  });
});

describe("md.memberNames", () => {
  it("extracts one name per backticked token, splitting on , and OR", () => {
    assertEquals(memberNames("`angle_to`, `angle`"), ["angle_to", "angle"]);
    assertEquals(
      memberNames("`click` OR `down`, `previous_click`, `up`"),
      ["click", "down", "previous_click", "up"],
    );
  });

  it("yields nothing for backtick-free category headings", () => {
    assertEquals(memberNames("Collection Render Orders"), []);
    assertEquals(memberNames("Status"), []);
  });
});

describe("md.parseHeadings", () => {
  it("ignores heading-like lines inside code fences", () => {
    const text = [
      "# Real (`args.outputs`)",
      "prose",
      "```ruby",
      "# mygame/app/main.rb",
      "def tick args",
      "end",
      "```",
      "## `sprites`",
      "more",
    ].join("\n");
    const hs = parseHeadings(text);
    assertEquals(hs.map((h) => h.text), [
      "Real (`args.outputs`)",
      "`sprites`",
    ]);
  });
});

describe("md.firstProse", () => {
  it("returns the first paragraph, stopping at a blank line or fence", () => {
    assertEquals(
      firstProse(["", "One line.", "still.", "", "later"]),
      "One line.\nstill.",
    );
    assertEquals(firstProse(["```ruby", "code", "```"]), "");
  });
});

describe("md.methodHeadingDocs", () => {
  it("maps every method-heading name to its first-prose doc", () => {
    const docs = methodHeadingDocs(
      "# Title\n\n## `foo`\n\nFoo does things.\n\n## `bar`, `baz`\n\nShared doc.\n",
    );
    assertEquals(docs.get("foo"), "Foo does things.");
    assertEquals(docs.get("bar"), "Shared doc.");
    assertEquals(docs.get("baz"), "Shared doc.");
  });
});

describe("md.classMethodBullets", () => {
  it("reads the `Class` Class Methods bullet list only", () => {
    const text =
      "# Array\n\n## `map_2d`\n\ninstance.\n\n## `Array` Class Methods\n\n- `filter_map`\n- `each`\n\n## `other`\n\n- `ignored`\n";
    assertEquals(classMethodBullets(text, "Array"), ["filter_map", "each"]);
    assertEquals(classMethodBullets(text, "Hash"), []);
  });
});

describe("md.codeFences / docOnlySignature", () => {
  it("collects ruby fence bodies", () => {
    const body = ["a", "```ruby", "def x", "end", "```", "b"];
    assertEquals(codeFences(body), ["def x\nend"]);
  });

  it("synthesizes a signature from exactly one unambiguous def", async () => {
    const ruby = await Ruby.init();
    const body = [
      "Does a thing.",
      "```ruby",
      "def thing(a, b, scale: 1)",
      "  a",
      "end",
      "```",
    ];
    const sig = docOnlySignature(ruby, body, "thing");
    assert(sig);
    assertEquals(sig.signature, "thing(a, b, scale: 1)");
    assertEquals(sig.params.map((p) => p.name), ["a", "b", "scale"]);
  });

  it("returns null when the fences are ambiguous (multiple defs)", async () => {
    const ruby = await Ruby.init();
    const body = [
      "```ruby",
      "def thing(a)",
      "end",
      "```",
      "```ruby",
      "def thing(a, b)",
      "end",
      "```",
    ];
    assertEquals(docOnlySignature(ruby, body, "thing"), null);
  });

  it("returns null when no def for the method is present", async () => {
    const ruby = await Ruby.init();
    assertEquals(
      docOnlySignature(ruby, ["```ruby", "thing 1, 2", "```"], "thing"),
      null,
    );
  });
});
