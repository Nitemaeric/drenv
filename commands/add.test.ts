import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import add from "./add.ts";
import { bundle } from "../utils/bundler.ts";
import { readLock } from "../utils/lockfile.ts";
import type { Project } from "../utils/project.ts";

const git = async (args: string[], cwd: string) => {
  const { success, stderr } = await new Deno.Command("git", {
    args: [
      // Isolate from the developer's global config so commits work anywhere.
      "-c",
      "user.name=drenv-test",
      "-c",
      "user.email=test@drenv.test",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!success) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`,
    );
  }
};

describe("add (sticky lock)", () => {
  let cwd: string;
  let tmp: string;
  let project: Project;
  let repo: string;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-add-" });

    // A local git repo standing in for an unpinned remote dep (tracks HEAD).
    repo = join(tmp, "frame-timer");
    await ensureDir(join(repo, "lib"));
    await Deno.writeTextFile(join(repo, "lib", "frame_timer.rb"), "# v1\n");
    await git(["init", "-b", "main"], repo);
    await git(["add", "."], repo);
    await git(["commit", "-m", "v1"], repo);

    // A second, path-sourced library to add later.
    await ensureDir(join(tmp, "other", "lib"));
    await Deno.writeTextFile(join(tmp, "other", "lib", "other.rb"), "# lib\n");

    const mygame = join(tmp, "game", "mygame");
    await ensureDir(join(mygame, "app"));
    await Deno.writeTextFile(
      join(mygame, "drenv.toml"),
      `[dependencies.frame_timer]\ngit = "${repo}"\n`,
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

  it("does not move existing locked refs when adding a dependency", async () => {
    await bundle(project);
    const before = await readLock(project.lockPath);
    const lockedRef = before?.dependencies.find((d) => d.name === "frame_timer")
      ?.ref;
    assertExists(lockedRef);

    // Upstream moves on after we locked.
    await Deno.writeTextFile(join(repo, "lib", "frame_timer.rb"), "# v2\n");
    await git(["add", "."], repo);
    await git(["commit", "-m", "v2"], repo);

    await add(`path:${join(tmp, "other")}`);

    const after = await readLock(project.lockPath);
    assertEquals(
      after?.dependencies.find((d) => d.name === "frame_timer")?.ref,
      lockedRef,
      "adding a dependency must not re-resolve existing locked refs",
    );
    assert(after?.dependencies.some((d) => d.name === "other"));
  });
});
