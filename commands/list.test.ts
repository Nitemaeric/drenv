import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import list from "./list.ts";
import { bundle } from "../utils/bundler.ts";
import type { Project } from "../utils/project.ts";

/** Builds a tmp project with one path dependency and returns it. */
const scaffold = async (
  prefix: string,
): Promise<{ tmp: string; project: Project }> => {
  const tmp = await Deno.makeTempDir({ prefix });

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

  return {
    tmp,
    project: {
      root: join(tmp, "game"),
      mygame,
      manifestPath: join(mygame, "drenv.toml"),
      lockPath: join(mygame, "drenv.lock"),
    },
  };
};

describe("list", () => {
  let cwd: string;
  let tmp: string;
  let project: Project;
  let logs: string[];
  let realLog: typeof console.log;

  beforeEach(async () => {
    cwd = Deno.cwd();
    ({ tmp, project } = await scaffold("drenv-list-"));
    await bundle(project);
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

  it("lists each dependency with its source", async () => {
    await list();

    const out = logs.join("\n");
    assertStringIncludes(out, "conjuration");
    assertStringIncludes(out, "path:../../lib");
  });
});
