import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";

import {
  type Lockfile,
  LOCKFILE_VERSION,
  readLock,
  writeLock,
} from "./lockfile.ts";

describe("lockfile", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-lock-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("round-trips a lockfile", async () => {
    const path = join(tmp, "drenv.lock");
    const lock: Lockfile = {
      lockfile_version: LOCKFILE_VERSION,
      manifest_digest: "sha256-abc",
      dependencies: [
        {
          name: "draco",
          source: "github:guitsaru/draco",
          ref: "deadbeef",
          require: ["vendor/draco/draco.rb"],
          integrity: "sha256-xyz",
        },
        {
          name: "local",
          source: "path:../lib",
          require: ["vendor/local/lib.rb"],
        },
      ],
    };

    await writeLock(path, lock);
    const read = await readLock(path);

    assert(read);
    assertEquals(read.lockfile_version, LOCKFILE_VERSION);
    assertEquals(read.dependencies.length, 2);
    assertEquals(read.dependencies[0].ref, "deadbeef");
    assertEquals(read.dependencies[1].integrity, undefined);
  });

  it("returns null when the lockfile is missing", async () => {
    assertEquals(await readLock(join(tmp, "missing.lock")), null);
  });

  it("omits undefined ref and integrity from the written file", async () => {
    const path = join(tmp, "drenv.lock");

    await writeLock(path, {
      lockfile_version: LOCKFILE_VERSION,
      manifest_digest: "sha256-abc",
      dependencies: [
        {
          name: "local",
          source: "path:../lib",
          require: ["vendor/local/lib.rb"],
        },
      ],
    });

    const text = await Deno.readTextFile(path);
    assertFalse(text.includes("integrity"));
    assertFalse(text.includes("ref ="));
  });
});
