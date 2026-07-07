import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { basename, dirname, normalize } from "@std/path";

import { homePath } from "../constants.ts";
import { makeDrenvTempDir } from "./temp.ts";

describe("makeDrenvTempDir", () => {
  it("creates a temp directory under ~/.drenv", async () => {
    const dir = await makeDrenvTempDir("drenv-test-");
    try {
      assertEquals(normalize(dirname(dir)), normalize(homePath));
      assertEquals(basename(dir).startsWith("drenv-test-"), true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
