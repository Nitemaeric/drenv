import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";

import version from "./version.ts";
import { ProjectNotFound } from "../utils/project.ts";

describe("version", () => {
  let cwd: string;
  let tmp: string;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-version-" });
    Deno.chdir(tmp);
    await ensureDir(`${tmp}/mygame`);
  });

  afterEach(async () => {
    Deno.chdir(cwd);
    await Deno.remove(tmp, { recursive: true });
  });

  it("returns the project's DragonRuby version", async () => {
    await Deno.writeTextFile(
      `${tmp}/CHANGELOG-CURR.txt`,
      "* 7.11\n** [Bugfix] something",
    );

    assertEquals(await version(), "7.11");
  });

  it("works from a subdirectory of the project", async () => {
    await Deno.writeTextFile(`${tmp}/CHANGELOG-CURR.txt`, "* 6.4");
    Deno.chdir(`${tmp}/mygame`);

    assertEquals(await version(), "6.4");
  });

  it("rejects when not inside a project", async () => {
    const bare = await Deno.makeTempDir({ prefix: "drenv-noproj-" });
    Deno.chdir(bare);

    try {
      await assertRejects(() => version(), ProjectNotFound);
    } finally {
      Deno.chdir(tmp);
      await Deno.remove(bare, { recursive: true });
    }
  });
});
