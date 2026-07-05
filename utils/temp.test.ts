import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { homePath } from "../constants.ts";
import { makeDrenvTempDir } from "./temp.ts";

describe("makeDrenvTempDir", () => {
  it("creates a temp directory under ~/.drenv", async () => {
    const dir = await makeDrenvTempDir("drenv-test-");
    try {
      assertEquals(dir.startsWith(`${homePath}/drenv-test-`), true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});