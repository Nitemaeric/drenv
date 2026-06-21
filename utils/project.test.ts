import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { findProject, ProjectNotFound } from "./project.ts";

describe("findProject", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-proj-" });
    await ensureDir(join(tmp, "game", "mygame", "app"));
    await Deno.writeTextFile(join(tmp, "game", "mygame", "drenv.toml"), "");
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("finds the project from its root", async () => {
    const project = await findProject(join(tmp, "game"));
    assertEquals(project.root, join(tmp, "game"));
    assertEquals(project.mygame, join(tmp, "game", "mygame"));
  });

  it("finds the project from inside the mygame directory", async () => {
    const project = await findProject(join(tmp, "game", "mygame", "app"));
    assertEquals(project.root, join(tmp, "game"));
  });

  it("rejects when no project is found", async () => {
    await assertRejects(() => findProject(tmp), ProjectNotFound);
  });
});
