import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import { bundle, reconcile, updateDependency } from "./bundler.ts";
import { readLock } from "./lockfile.ts";
import type { Project } from "./project.ts";

const git = async (args: string[], cwd: string) => {
  const { success, stderr } = await new Deno.Command("git", {
    args: [
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

/** A library at <tmp>/<name> with lib/<name>.rb and an optional drenv.toml. */
const makeLib = async (
  tmp: string,
  name: string,
  manifest?: string,
  content = `# ${name}\n`,
) => {
  const dir = join(tmp, name);
  await ensureDir(join(dir, "lib"));
  await Deno.writeTextFile(join(dir, "lib", `${name}.rb`), content);
  if (manifest) {
    await Deno.writeTextFile(join(dir, "drenv.toml"), manifest);
  }
  return dir;
};

const makeGame = async (tmp: string, manifest: string): Promise<Project> => {
  const mygame = join(tmp, "game", "mygame");
  await ensureDir(join(mygame, "app"));
  await Deno.writeTextFile(join(mygame, "drenv.toml"), manifest);
  await Deno.writeTextFile(
    join(mygame, "app", "main.rb"),
    "def tick args\nend\n",
  );

  return {
    root: join(tmp, "game"),
    mygame,
    manifestPath: join(mygame, "drenv.toml"),
    lockPath: join(mygame, "drenv.lock"),
  };
};

describe("bundler (nested dependencies)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-nested-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("resolves a transitive path dep flat, with via and require order", async () => {
    // dragon_input ships an asset dir via include; conjuration depends on it.
    const diDir = join(tmp, "dragon_input");
    await ensureDir(join(diDir, "lib"));
    await ensureDir(join(diDir, "sprites"));
    await Deno.writeTextFile(join(diDir, "lib", "dragon_input.rb"), "# di\n");
    await Deno.writeTextFile(join(diDir, "sprites", "a.png"), "PNG");
    await Deno.writeTextFile(
      join(diDir, "drenv.toml"),
      '[package]\nroot = "lib"\nentrypoint = "dragon_input.rb"\ninclude = ["sprites"]\n',
    );

    await makeLib(
      tmp,
      "conjuration",
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n\n' +
        '[dependencies.dragon_input]\npath = "../dragon_input"\n',
    );

    const project = await makeGame(
      tmp,
      '[dependencies.conjuration]\npath = "../../conjuration"\n',
    );

    await bundle(project);

    // Both vendored flat, transitive include assets flowing through.
    assert(
      await exists(
        join(project.mygame, "vendor", "conjuration", "conjuration.rb"),
      ),
    );
    assert(
      await exists(
        join(project.mygame, "vendor", "dragon_input", "dragon_input.rb"),
      ),
    );
    assert(
      await exists(
        join(project.mygame, "vendor", "dragon_input", "sprites", "a.png"),
      ),
    );

    // The lock records the graph edge.
    const lock = await readLock(project.lockPath);
    const di = lock?.dependencies.find((d) => d.name === "dragon_input");
    assertEquals(di?.via, ["conjuration"]);
    assertEquals(
      lock?.dependencies.find((d) => d.name === "conjuration")?.via,
      undefined,
    );

    // Dependencies are required before their dependents.
    const bundleFile = await Deno.readTextFile(
      join(project.mygame, "app", "drenv_bundle.rb"),
    );
    assert(
      bundleFile.indexOf("vendor/dragon_input/") <
        bundleFile.indexOf("vendor/conjuration/"),
      "dragon_input must be required before conjuration",
    );
  });

  it("prefers the game's top-level spec over a transitive one", async () => {
    await makeLib(tmp, "dragon_input", undefined, "# upstream\n");
    await makeLib(tmp, "dragon_input_alt", undefined, "# mine\n");
    // The alt library still exposes the dragon_input entrypoint name.
    await Deno.writeTextFile(
      join(tmp, "dragon_input_alt", "lib", "dragon_input.rb"),
      "# mine\n",
    );
    await makeLib(
      tmp,
      "conjuration",
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n\n' +
        '[dependencies.dragon_input]\npath = "../dragon_input"\n',
    );

    const project = await makeGame(
      tmp,
      '[dependencies.conjuration]\npath = "../../conjuration"\n\n' +
        '[dependencies.dragon_input]\npath = "../../dragon_input_alt"\n',
    );

    await bundle(project);

    assertEquals(
      await Deno.readTextFile(
        join(project.mygame, "vendor", "dragon_input", "dragon_input.rb"),
      ),
      "# mine\n",
    );
  });

  it("rejects conflicting transitive specs without a top-level arbiter", async () => {
    await makeLib(tmp, "shared1");
    await makeLib(tmp, "shared2");
    await Deno.writeTextFile(
      join(tmp, "shared1", "lib", "shared.rb"),
      "# one\n",
    );
    await Deno.writeTextFile(
      join(tmp, "shared2", "lib", "shared.rb"),
      "# two\n",
    );
    await makeLib(
      tmp,
      "parent_a",
      '[package]\nroot = "lib"\nentrypoint = "parent_a.rb"\n\n' +
        '[dependencies.shared]\npath = "../shared1"\n',
    );
    await makeLib(
      tmp,
      "parent_b",
      '[package]\nroot = "lib"\nentrypoint = "parent_b.rb"\n\n' +
        '[dependencies.shared]\npath = "../shared2"\n',
    );

    const project = await makeGame(
      tmp,
      '[dependencies.parent_a]\npath = "../../parent_a"\n\n' +
        '[dependencies.parent_b]\npath = "../../parent_b"\n',
    );

    await assertRejects(
      () => bundle(project),
      Error,
      "conflicting specs for 'shared'",
    );
  });

  it("rejects a path dependency declared by a remote source", async () => {
    const repo = await makeLib(
      tmp,
      "remote_parent",
      '[package]\nroot = "lib"\nentrypoint = "remote_parent.rb"\n\n' +
        '[dependencies.local_helper]\npath = "../helper"\n',
    );
    await git(["init", "-b", "main"], repo);
    await git(["add", "."], repo);
    await git(["commit", "-m", "v1"], repo);

    const project = await makeGame(
      tmp,
      `[dependencies.remote_parent]\ngit = "${repo.replaceAll("\\", "/")}"\n`,
    );

    await assertRejects(
      () => bundle(project),
      Error,
      "can't be transitive from remote sources",
    );
  });

  it("rejects dependency cycles", async () => {
    await makeLib(
      tmp,
      "lib_a",
      '[package]\nroot = "lib"\nentrypoint = "lib_a.rb"\n\n' +
        '[dependencies.lib_b]\npath = "../lib_b"\n',
    );
    await makeLib(
      tmp,
      "lib_b",
      '[package]\nroot = "lib"\nentrypoint = "lib_b.rb"\n\n' +
        '[dependencies.lib_a]\npath = "../lib_a"\n',
    );

    const project = await makeGame(
      tmp,
      '[dependencies.lib_a]\npath = "../../lib_a"\n',
    );

    await assertRejects(() => bundle(project), Error, "dependency cycle");
  });

  it("keeps a locked transitive ref when updating an unrelated dep", async () => {
    // timer: a git repo standing in for an unpinned remote transitive dep.
    const timer = await makeLib(tmp, "timer");
    await git(["init", "-b", "main"], timer);
    await git(["add", "."], timer);
    await git(["commit", "-m", "v1"], timer);

    await makeLib(
      tmp,
      "conjuration",
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n\n' +
        `[dependencies.timer]\ngit = "${timer.replaceAll("\\", "/")}"\n`,
    );
    await makeLib(tmp, "other");

    const project = await makeGame(
      tmp,
      '[dependencies.conjuration]\npath = "../../conjuration"\n\n' +
        '[dependencies.other]\npath = "../../other"\n',
    );

    await bundle(project);
    const lockedRef = (await readLock(project.lockPath))?.dependencies.find(
      (d) => d.name === "timer",
    )?.ref;
    assertExists(lockedRef);

    // Upstream moves on after we locked.
    await Deno.writeTextFile(join(timer, "lib", "timer.rb"), "# v2\n");
    await git(["add", "."], timer);
    await git(["commit", "-m", "v2"], timer);

    // Updating an unrelated dep must not move the transitive ref...
    await updateDependency(project, "other");
    assertEquals(
      (await readLock(project.lockPath))?.dependencies.find(
        (d) => d.name === "timer",
      )?.ref,
      lockedRef,
    );

    // ...and neither must updating its parent (spec unchanged = reuse).
    await updateDependency(project, "conjuration");
    assertEquals(
      (await readLock(project.lockPath))?.dependencies.find(
        (d) => d.name === "timer",
      )?.ref,
      lockedRef,
    );
  });

  it("names the parents when updating a transitive dep directly", async () => {
    await makeLib(tmp, "dragon_input");
    await makeLib(
      tmp,
      "conjuration",
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n\n' +
        '[dependencies.dragon_input]\npath = "../dragon_input"\n',
    );

    const project = await makeGame(
      tmp,
      '[dependencies.conjuration]\npath = "../../conjuration"\n',
    );
    await bundle(project);

    await assertRejects(
      () => updateDependency(project, "dragon_input"),
      Error,
      "via conjuration",
    );
  });

  it("restores a missing transitive vendor dir from the lock on reconcile", async () => {
    const timer = await makeLib(tmp, "timer");
    await git(["init", "-b", "main"], timer);
    await git(["add", "."], timer);
    await git(["commit", "-m", "v1"], timer);

    await makeLib(
      tmp,
      "conjuration",
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n\n' +
        `[dependencies.timer]\ngit = "${timer.replaceAll("\\", "/")}"\n`,
    );

    const project = await makeGame(
      tmp,
      '[dependencies.conjuration]\npath = "../../conjuration"\n',
    );
    await bundle(project);

    // Upstream advances, then the vendored copy goes missing (fresh clone).
    await Deno.writeTextFile(join(timer, "lib", "timer.rb"), "# v2\n");
    await git(["add", "."], timer);
    await git(["commit", "-m", "v2"], timer);
    await Deno.remove(join(project.mygame, "vendor", "timer"), {
      recursive: true,
    });

    await reconcile(project);

    // Restored at the locked revision, not upstream HEAD. Normalize line
    // endings: git's autocrlf checks files out with \r\n on Windows runners.
    const restored = await Deno.readTextFile(
      join(project.mygame, "vendor", "timer", "timer.rb"),
    );
    assertEquals(restored.replaceAll("\r\n", "\n"), "# timer\n");
  });

  it("drops orphaned packages when a parent stops depending on them", async () => {
    await makeLib(tmp, "dragon_input");
    const conjDir = await makeLib(
      tmp,
      "conjuration",
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n\n' +
        '[dependencies.dragon_input]\npath = "../dragon_input"\n',
    );

    const project = await makeGame(
      tmp,
      '[dependencies.conjuration]\npath = "../../conjuration"\n',
    );
    await bundle(project);
    assert(await exists(join(project.mygame, "vendor", "dragon_input")));

    // Conjuration drops the dependency; updating it prunes the orphan.
    await Deno.writeTextFile(
      join(conjDir, "drenv.toml"),
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n',
    );
    await updateDependency(project, "conjuration");

    const lock = await readLock(project.lockPath);
    assertEquals(
      lock?.dependencies.some((d) => d.name === "dragon_input"),
      false,
    );
    assertEquals(
      await exists(join(project.mygame, "vendor", "dragon_input")),
      false,
    );
  });

  it("surfaces the top-level override in the log", async () => {
    await makeLib(tmp, "dragon_input");
    await makeLib(tmp, "dragon_input_alt");
    await Deno.writeTextFile(
      join(tmp, "dragon_input_alt", "lib", "dragon_input.rb"),
      "# mine\n",
    );
    await makeLib(
      tmp,
      "conjuration",
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n\n' +
        '[dependencies.dragon_input]\npath = "../dragon_input"\n',
    );

    const project = await makeGame(
      tmp,
      '[dependencies.conjuration]\npath = "../../conjuration"\n\n' +
        '[dependencies.dragon_input]\npath = "../../dragon_input_alt"\n',
    );

    const logs: string[] = [];
    await bundle(project, { log: (m) => logs.push(m) });

    assertStringIncludes(
      logs.join("\n"),
      "using your spec",
    );
  });
});
