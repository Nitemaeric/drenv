import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import update from "./update.ts";
import { bundle } from "../utils/bundler.ts";
import type { Project } from "../utils/project.ts";

describe("update", () => {
  let cwd: string;
  let tmp: string;
  let project: Project;
  let logs: string[];
  let realLog: typeof console.log;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-update-" });

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

    logs = [];
    realLog = console.log;
    console.log = (...args) => logs.push(args.map(String).join(" "));
  });

  afterEach(async () => {
    console.log = realLog;
    Deno.chdir(cwd);
    await Deno.remove(tmp, { recursive: true });
  });

  it("resolves and reports newly added dependencies", async () => {
    await update();

    const out = logs.join("\n");
    assertStringIncludes(out, "conjuration");
    assertStringIncludes(out, "added");
    assert(await exists(join(project.mygame, "drenv.lock")));
  });

  it("reports up to date when nothing changed", async () => {
    await bundle(project);

    // A path dependency has no revision, so re-resolving changes nothing.
    assertEquals(await update("conjuration"), "drenv: already up to date");
  });

  it("rejects an unknown dependency name", async () => {
    await bundle(project);

    await assertRejects(
      () => update("nope"),
      Error,
      "no dependency named 'nope'",
    );
  });
});
