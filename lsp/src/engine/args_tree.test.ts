import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { buildArgsChains, expandChain } from "./args_tree.ts";

describe("args_tree.expandChain", () => {
  it("expands the controller (one-four) form", () => {
    assertEquals(expandChain("args.inputs.controller_(one-four)"), [
      "args.inputs.controller_one",
      "args.inputs.controller_two",
      "args.inputs.controller_three",
      "args.inputs.controller_four",
    ]);
  });

  it("expands the key (down|up|held) alternation form", () => {
    assertEquals(expandChain("args.inputs.key_(down|up|held)"), [
      "args.inputs.key_down",
      "args.inputs.key_up",
      "args.inputs.key_held",
    ]);
  });

  it("keeps a plain chain untouched", () => {
    assertEquals(expandChain("args.inputs.mouse"), ["args.inputs.mouse"]);
  });

  it("keeps an unrecognized parenthetical literal", () => {
    assertEquals(expandChain("args.inputs.foo_(weird)"), [
      "args.inputs.foo_(weird)",
    ]);
  });
});

describe("args_tree.buildArgsChains", () => {
  let dir: string;

  const labels = (chains: Map<string, { label: string }[]>, key: string) =>
    (chains.get(key) ?? []).map((e) => e.label);

  beforeAll(async () => {
    dir = await Deno.makeTempDir({ prefix: "drenv-args-" });
    await ensureDir(join(dir, "docs", "oss", "dragon"));
    await ensureDir(join(dir, "docs", "api"));
    await Deno.writeTextFile(
      join(dir, "docs", "oss", "dragon", "args.rb"),
      [
        "module GTK",
        "  class Args",
        "    attr_accessor :inputs",
        "    attr_accessor :outputs",
        "    attr_accessor :state",
        "    attr_accessor :runtime",
        "    alias_method :gtk, :runtime",
        "  end",
        "end",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      join(dir, "docs", "api", "inputs.md"),
      [
        "# Inputs (`args.inputs`)",
        "",
        "## `up`",
        "",
        "Up pressed.",
        "",
        "## Mouse (`args.inputs.mouse`)",
        "",
        "### `x`",
        "",
        "Mouse x.",
        "",
        "### `click` OR `down`",
        "",
        "Clicked.",
        "",
        "## Controller (`args.inputs.controller_(one-four)`)",
        "",
        "### `connected`",
        "",
        "Connected.",
        "",
        "## Keyboard or Controller On (`args.inputs.key_(down|up|held)`)",
        "",
        "## Keyboard (`args.inputs.keyboard`)",
        "",
        "### `key_down`",
        "",
        "Keys down.",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      join(dir, "docs", "api", "state.md"),
      "# State (`args.state`)\n\n## `enemies`\n\nUser defined.\n",
    );
  });

  afterAll(async () => {
    await Deno.remove(dir, { recursive: true });
  });

  it("unions md H1 roots with args.rb accessors and aliases for args.", async () => {
    const chains = await buildArgsChains(dir);
    const args = labels(chains, "args");
    for (const m of ["inputs", "outputs", "state", "runtime", "gtk"]) {
      assert(args.includes(m), `args. missing ${m}`);
    }
  });

  it("keys nested chains separately and registers leaves on the parent", async () => {
    const chains = await buildArgsChains(dir);
    assert(labels(chains, "args.inputs").includes("up"));
    for (const leaf of ["mouse", "keyboard", "controller_one"]) {
      assert(labels(chains, "args.inputs").includes(leaf), `missing ${leaf}`);
    }
    assert(labels(chains, "args.inputs.mouse").includes("x"));
    assert(labels(chains, "args.inputs.mouse").includes("click"));
    assert(labels(chains, "args.inputs.mouse").includes("down"));
    assert(labels(chains, "args.inputs.keyboard").includes("key_down"));
  });

  it("expands controller_(one-four) into four member-carrying chains", async () => {
    const chains = await buildArgsChains(dir);
    for (const n of ["one", "two", "three", "four"]) {
      assert(
        labels(chains, `args.inputs.controller_${n}`).includes("connected"),
        `controller_${n} missing connected`,
      );
    }
  });

  it("closes a chain at the next annotation of any level (H2 after H1)", async () => {
    const chains = await buildArgsChains(dir);
    // `up` belongs to args.inputs, NOT to the H2 mouse chain that follows.
    assert(!labels(chains, "args.inputs.mouse").includes("up"));
    // The empty key_(...) section registers leaves but forms no member chains.
    assert(labels(chains, "args.inputs").includes("key_down"));
    assertEquals(chains.has("args.inputs.key_down"), false);
  });

  it("lists no-submember chains as args. members but emits no chain entry", async () => {
    const chains = await buildArgsChains(dir);
    assert(labels(chains, "args").includes("state"));
    assertEquals(chains.has("args.state"), false);
  });

  it("attaches first-prose docs to members", async () => {
    const chains = await buildArgsChains(dir);
    const up = chains.get("args.inputs")?.find((e) => e.label === "up");
    assertEquals(up?.doc, "Up pressed.");
    // Accessor-only members (no md) fall back to the generic label.
    const runtime = chains.get("args")?.find((e) => e.label === "runtime");
    assertEquals(runtime?.doc, "DragonRuby `args.runtime`");
  });

  it("returns an empty map when the engine dir has no docs", async () => {
    const empty = await buildArgsChains(await Deno.makeTempDir());
    assertEquals(empty.size, 0);
  });
});
