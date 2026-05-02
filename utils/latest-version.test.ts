import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { getLatestAvailableVersion } from "./latest-version.ts";

describe("getLatestAvailableVersion", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("when the response is a version string", () => {
    beforeEach(() => {
      globalThis.fetch = () =>
        Promise.resolve(new Response("6.57\n", { status: 200 }));
    });

    it("returns the trimmed version", async () => {
      const result = await getLatestAvailableVersion();

      assertEquals(result, "6.57");
    });
  });

  describe("when the response body is not a version", () => {
    beforeEach(() => {
      globalThis.fetch = () =>
        Promise.resolve(new Response("<html>oops</html>", { status: 200 }));
    });

    it("returns undefined", async () => {
      const result = await getLatestAvailableVersion();

      assertEquals(result, undefined);
    });
  });

  describe("when the response is not ok", () => {
    beforeEach(() => {
      globalThis.fetch = () =>
        Promise.resolve(new Response("Not Found", { status: 404 }));
    });

    it("returns undefined", async () => {
      const result = await getLatestAvailableVersion();

      assertEquals(result, undefined);
    });
  });

  describe("when fetch throws", () => {
    beforeEach(() => {
      globalThis.fetch = () => Promise.reject(new Error("offline"));
    });

    it("returns undefined", async () => {
      const result = await getLatestAvailableVersion();

      assertEquals(result, undefined);
    });
  });
});
