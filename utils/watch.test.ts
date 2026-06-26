import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { bundle } from "./bundler.ts";
import { watchPathDeps } from "./watch.ts";
import type { Project } from "./project.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `read` until it returns `expected`, up to `timeoutMs`. */
const waitFor = async (
  read: () => Promise<string>,
  expected: string,
  timeoutMs = 8000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await read()) === expected) return true;
    } catch {
      // file mid-write — retry
    }
    await delay(50);
  }
  return false;
};

describe("watchPathDeps", () => {
  let tmp: string;
  let project: Project;
  let controller: AbortController;
  let watching: Promise<void>;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-watch-" });

    await ensureDir(join(tmp, "lib", "conjuration"));
    await Deno.writeTextFile(
      join(tmp, "lib", "conjuration.rb"),
      'require_relative "conjuration/node"\n',
    );
    await Deno.writeTextFile(
      join(tmp, "lib", "conjuration", "node.rb"),
      "class Node; end\n",
    );

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

    await bundle(project);
  });

  afterEach(async () => {
    controller?.abort();
    await watching?.catch(() => {});
    await Deno.remove(tmp, { recursive: true });
  });

  it("re-vendors a path dep when its source changes", async () => {
    const vendored = join(
      project.mygame,
      "vendor",
      "conjuration",
      "conjuration",
      "node.rb",
    );

    controller = new AbortController();
    watching = watchPathDeps(project, controller.signal, () => {});
    await delay(400); // let the watcher start before editing

    await Deno.writeTextFile(
      join(tmp, "lib", "conjuration", "node.rb"),
      "class Node; def x; end; end\n",
    );

    const synced = await waitFor(
      () => Deno.readTextFile(vendored),
      "class Node; def x; end; end\n",
    );
    assert(
      synced,
      "vendored file should be re-synced after the source changed",
    );
  });
});
