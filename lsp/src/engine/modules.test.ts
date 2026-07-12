import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

import { Ruby } from "../ruby.ts";
import { buildModule } from "./modules.ts";

let ruby: Ruby;
let dir: string;

const writeFixture = async (name: string, source: string) => {
  const oss = join(dir, "docs", "oss", "dragon");
  await Deno.mkdir(oss, { recursive: true });
  await Deno.writeTextFile(join(oss, name), source);
};

beforeAll(async () => {
  ruby = await Ruby.init();
  dir = await Deno.makeTempDir();
});

afterAll(async () => {
  await Deno.remove(dir, { recursive: true });
});

describe("buildModule singleton methods", () => {
  it("indexes `def self.x` methods (easing-style modules)", async () => {
    await writeFixture(
      "easing.rb",
      `module GTK
  module Easing
    def self.ease start_tick, current_tick, duration, *definitions
    end

    # blends two definitions
    def self.mix a, b, perc
    end

    def self.identity x
    end
  end
end`,
    );

    const entries = await buildModule(ruby, dir, "easing.rb");
    const labels = entries.map((e) => e.label);
    assertEquals(labels, ["ease", "mix", "identity"]);

    const ease = entries.find((e) => e.label === "ease")!;
    assertEquals(
      ease.signature,
      "ease(start_tick, current_tick, duration, *definitions)",
    );
    assertEquals(ease.params?.map((p) => p.kind), [
      "required",
      "required",
      "required",
      "rest",
    ]);

    // Doc extraction works for a singleton method that isn't first in its
    // module (the parser hoists a module's first leading comment onto the
    // module node, so first-in-module docs are unreachable by either path).
    const mix = entries.find((e) => e.label === "mix")!;
    assertEquals(mix.doc, "blends two definitions");
  });

  it("skips underscore-prefixed singleton methods", async () => {
    await writeFixture(
      "easing.rb",
      `module GTK
  module Easing
    def self.__resolve_params__ m
    end

    def self.mix a, b
    end
  end
end`,
    );

    const labels = (await buildModule(ruby, dir, "easing.rb")).map((e) =>
      e.label
    );
    assertEquals(labels, ["mix"]);
  });
});

describe("buildModule module scoping", () => {
  it("does not misattribute a foreign module's singleton methods", async () => {
    // geometry.rb opens `module Math; def self.pow` before its own module —
    // Math.pow must never land in Geometry's entry list.
    await writeFixture(
      "geometry.rb",
      `module Math
  def self.pow base, exponent
    base ** exponent
  end
end

module GTK
  module Geometry
    def inside_rect? outer
    end

    class << self
      def rotate_point point, angle
      end
    end
  end
end`,
    );

    const labels = (await buildModule(ruby, dir, "geometry.rb")).map((e) =>
      e.label
    );
    assert(labels.includes("inside_rect?"));
    assert(labels.includes("rotate_point"));
    assert(!labels.includes("pow"), "Math.pow must not leak into Geometry");
  });

  it("derives the target module from a multi-word filename", async () => {
    await writeFixture(
      "some_thing.rb",
      `module GTK
  module SomeThing
    def self.go a
    end
  end
end`,
    );

    const labels = (await buildModule(ruby, dir, "some_thing.rb")).map((e) =>
      e.label
    );
    assertEquals(labels, ["go"]);
  });

  it("returns nothing for a missing file", async () => {
    assertEquals(await buildModule(ruby, dir, "nope.rb"), []);
  });
});
