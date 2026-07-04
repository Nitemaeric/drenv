import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import outdated from "./outdated.ts";
import { bundle } from "../utils/bundler.ts";
import type { Project } from "../utils/project.ts";

describe("outdated", () => {
  let cwd: string;
  let tmp: string;
  let project: Project;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-outdated-" });

    await ensureDir(join(tmp, "lib"));
    await Deno.writeTextFile(join(tmp, "lib", "conjuration.rb"), "# lib\n");

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
    Deno.chdir(project.root);
  });

  afterEach(async () => {
    Deno.chdir(cwd);
    await Deno.remove(tmp, { recursive: true });
  });

  it("reports all up to date when only path deps are present", async () => {
    await bundle(project);

    // Path deps aren't revision-tracked, so there's nothing to flag.
    assertEquals(await outdated(), "drenv: all dependencies up to date");
  });

  it("rejects when there is no lockfile", async () => {
    await assertRejects(() => outdated(), Error, "no lockfile");
  });
});
