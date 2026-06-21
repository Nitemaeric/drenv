import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import { bundle, reconcile } from "./bundler.ts";
import { readLock } from "./lockfile.ts";
import type { Project } from "./project.ts";

describe("bundler (path source)", () => {
  let tmp: string;
  let project: Project;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-bundle-" });

    // Canonical library at <tmp>/lib, mirroring conjuration's layout.
    await ensureDir(join(tmp, "lib", "conjuration"));
    await Deno.writeTextFile(
      join(tmp, "lib", "conjuration.rb"),
      'require_relative "conjuration/node"\n',
    );
    await Deno.writeTextFile(
      join(tmp, "lib", "conjuration", "node.rb"),
      "class Node; end\n",
    );

    // Project at <tmp>/game with a mygame/ game directory.
    const mygame = join(tmp, "game", "mygame");
    await ensureDir(join(mygame, "app"));
    await Deno.writeTextFile(
      join(mygame, "drenv.toml"),
      '[dependencies.conjuration]\npath = "../../lib"\nentrypoint = "conjuration.rb"\n',
    );
    await Deno.writeTextFile(
      join(mygame, "app", "main.rb"),
      "def tick args\nend\n",
    );

    project = {
      root: join(tmp, "game"),
      mygame,
      manifestPath: join(mygame, "drenv.toml"),
      lockPath: join(mygame, "drenv.lock"),
    };
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("copies the library tree into mygame/vendor", async () => {
    await bundle(project);

    assertEquals(
      await Deno.readTextFile(
        join(project.mygame, "vendor", "conjuration", "conjuration.rb"),
      ),
      'require_relative "conjuration/node"\n',
    );
    assertEquals(
      await Deno.readTextFile(
        join(project.mygame, "vendor", "conjuration", "conjuration", "node.rb"),
      ),
      "class Node; end\n",
    );
  });

  it("generates a bundle file that requires the entrypoint", async () => {
    await bundle(project);

    const generated = await Deno.readTextFile(
      join(project.mygame, "app", "drenv_bundle.rb"),
    );
    assert(generated.includes("require 'vendor/conjuration/conjuration.rb'"));
  });

  it("locks the path dependency without an integrity hash", async () => {
    await bundle(project);

    const lock = await readLock(project.lockPath);
    assert(lock);
    assertEquals(lock.dependencies.length, 1);
    assertEquals(lock.dependencies[0].name, "conjuration");
    assertEquals(lock.dependencies[0].source, "path:../../lib");
    assertEquals(lock.dependencies[0].require, [
      "vendor/conjuration/conjuration.rb",
    ]);
    assertEquals(lock.dependencies[0].integrity, undefined);
  });

  it("flags main.rb until it requires the bundle", async () => {
    assert((await bundle(project)).needsRequireLine);

    await Deno.writeTextFile(
      join(project.mygame, "app", "main.rb"),
      "require 'app/drenv_bundle.rb'\ndef tick args\nend\n",
    );

    assertFalse((await bundle(project)).needsRequireLine);
  });

  it("re-syncs path deps on reconcile when the source changes", async () => {
    await bundle(project);

    await Deno.writeTextFile(
      join(tmp, "lib", "conjuration", "node.rb"),
      "class Node; def x; end; end\n",
    );

    await reconcile(project);

    assertEquals(
      await Deno.readTextFile(
        join(project.mygame, "vendor", "conjuration", "conjuration", "node.rb"),
      ),
      "class Node; def x; end; end\n",
    );
  });

  it("removes vendored files that disappear from the source", async () => {
    await bundle(project);
    await Deno.remove(join(tmp, "lib", "conjuration", "node.rb"));

    // Drop the require_relative so the entrypoint check still passes.
    await Deno.writeTextFile(join(tmp, "lib", "conjuration.rb"), "# empty\n");

    await reconcile(project);

    assertFalse(
      await exists(
        join(project.mygame, "vendor", "conjuration", "conjuration", "node.rb"),
      ),
    );
  });
});
