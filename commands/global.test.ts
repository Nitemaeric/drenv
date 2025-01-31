import { beforeAll, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";

import global, { NoGlobalVersion } from "./global.ts";

describe("global", () => {
  describe("when an argument is passed", () => {
    describe("when DR version has been registered", () => {
      beforeAll(async () => {
        await ensureDir(`${Deno.env.get("HOME")}/.drenv/versions/1.0.0`);
        await Deno.writeTextFile(
          `${Deno.env.get("HOME")}/.drenv/versions/1.0.0/CHANGELOG-CURR.txt`,
          "* 1.0.0",
        );
      });

      it("writes to the ~/.drenv/.dragonruby-version file", async () => {
        await global("1.0.0");

        const result = await Deno.readTextFile(
          `${Deno.env.get("HOME")}/.drenv/.dragonruby-version`,
        );

        assertEquals(result, "1.0.0");
      });
    });
  });

  describe("when an argument is not passed", () => {
    describe("when version has been set", () => {
      beforeAll(async () => {
        await Deno.writeTextFile(
          `${Deno.env.get("HOME")}/.drenv/.dragonruby-version`,
          "1.0.0",
        );
      });

      it("returns the version from the ~/.drenv/.dragonruby-version file", async () => {
        const result = await global();

        assertEquals(result, "1.0.0");
      });
    });

    describe("when version has not been set", () => {
      beforeAll(async () => {
        await Deno.remove(`${Deno.env.get("HOME")}/.drenv/.dragonruby-version`);
      });

      it("raises an error", () => {
        assertRejects(
          async () => {
            await global();
          },
          NoGlobalVersion,
          "drenv: no global version configured",
        );
      });
    });
  });
});
