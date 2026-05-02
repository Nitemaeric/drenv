import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";

import changelog from "./changelog.ts";
import { versionsPath } from "../constants.ts";

const FIXTURE = `* 99.99
** [Bugfix] Fixed a thing in the latest version.
** [Support] Added a new helper.
* 99.98
** [Bugfix] Fixed a thing in the previous version.
* 99.97
** [Bugfix] Fixed an even older thing.
`;

describe("changelog", () => {
  beforeAll(async () => {
    await ensureDir(`${versionsPath}/99.99`);
    await ensureDir(`${versionsPath}/99.98`);
    await Deno.writeTextFile(
      `${versionsPath}/99.99/CHANGELOG-CURR.txt`,
      FIXTURE,
    );
    await Deno.writeTextFile(
      `${versionsPath}/99.98/CHANGELOG-CURR.txt`,
      FIXTURE,
    );
  });

  afterAll(async () => {
    await Deno.remove(`${versionsPath}/99.99`, { recursive: true });
    await Deno.remove(`${versionsPath}/99.98`, { recursive: true });
  });

  describe("when no version is passed", () => {
    it("returns the entry for the latest installed version", async () => {
      const result = await changelog();

      assertEquals(
        result,
        "* 99.99\n" +
          "** [Bugfix] Fixed a thing in the latest version.\n" +
          "** [Support] Added a new helper.",
      );
    });
  });

  describe("when a version is passed", () => {
    it("returns the entry for that version", async () => {
      const result = await changelog("99.98");

      assertEquals(
        result,
        "* 99.98\n** [Bugfix] Fixed a thing in the previous version.",
      );
    });

    it("returns the last entry without a trailing version header", async () => {
      const result = await changelog("99.97");

      assertEquals(
        result,
        "* 99.97\n** [Bugfix] Fixed an even older thing.",
      );
    });

    it("rejects when the version is not in the changelog", async () => {
      await assertRejects(
        () => changelog("0.0"),
        Error,
        "drenv: no changelog entry found for version 0.0",
      );
    });
  });
});
