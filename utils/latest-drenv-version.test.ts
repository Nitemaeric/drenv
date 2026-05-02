import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import {
  fetchLatestDrenvVersion,
  getLatestDrenvVersion,
} from "./latest-drenv-version.ts";

const originalFetch = globalThis.fetch;

const stubFetch = (response: Response | (() => Promise<Response>)) => {
  globalThis.fetch = typeof response === "function"
    ? (() => response()) as typeof fetch
    : (() => Promise.resolve(response)) as typeof fetch;
};

const stubFetchReject = (error: Error) => {
  globalThis.fetch = (() => Promise.reject(error)) as typeof fetch;
};

const restoreFetch = () => {
  globalThis.fetch = originalFetch;
};

describe("fetchLatestDrenvVersion", () => {
  afterEach(restoreFetch);

  describe("when the response carries a tag_name", () => {
    beforeEach(() => {
      stubFetch(
        new Response(JSON.stringify({ tag_name: "v0.7.0" }), { status: 200 }),
      );
    });

    it("returns the version with the v prefix stripped", async () => {
      assertEquals(await fetchLatestDrenvVersion(), "0.7.0");
    });
  });

  describe("when tag_name has no v prefix", () => {
    beforeEach(() => {
      stubFetch(
        new Response(JSON.stringify({ tag_name: "0.7.0" }), { status: 200 }),
      );
    });

    it("returns the tag as-is", async () => {
      assertEquals(await fetchLatestDrenvVersion(), "0.7.0");
    });
  });

  describe("when tag_name is missing", () => {
    beforeEach(() => {
      stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    });

    it("returns undefined", async () => {
      assertEquals(await fetchLatestDrenvVersion(), undefined);
    });
  });

  describe("when tag_name is malformed", () => {
    beforeEach(() => {
      stubFetch(
        new Response(JSON.stringify({ tag_name: "vNEXT" }), { status: 200 }),
      );
    });

    it("returns undefined", async () => {
      assertEquals(await fetchLatestDrenvVersion(), undefined);
    });
  });

  describe("when the response is not ok", () => {
    beforeEach(() => {
      stubFetch(new Response("rate limited", { status: 403 }));
    });

    it("returns undefined", async () => {
      assertEquals(await fetchLatestDrenvVersion(), undefined);
    });
  });

  describe("when fetch throws", () => {
    beforeEach(() => {
      stubFetchReject(new Error("offline"));
    });

    it("returns undefined", async () => {
      assertEquals(await fetchLatestDrenvVersion(), undefined);
    });
  });
});

describe("getLatestDrenvVersion", () => {
  let kv: Deno.Kv;

  beforeEach(async () => {
    kv = await Deno.openKv(":memory:");
  });

  afterEach(() => {
    kv.close();
    restoreFetch();
  });

  describe("when the cache is empty", () => {
    beforeEach(() => {
      stubFetch(
        new Response(JSON.stringify({ tag_name: "v0.7.0" }), { status: 200 }),
      );
    });

    it("fetches and stores the version", async () => {
      assertEquals(await getLatestDrenvVersion(kv), "0.7.0");

      const stored = (await kv.get(["drenv", "latestVersion"])).value as
        | { version: string }
        | null;
      assertEquals(stored?.version, "0.7.0");
    });
  });

  describe("when the cache is fresh", () => {
    beforeEach(async () => {
      await kv.set(["drenv", "latestVersion"], {
        version: "0.6.0",
        checkedAt: Date.now(),
      });
      stubFetchReject(new Error("must not be called"));
    });

    it("returns the cached value without fetching", async () => {
      assertEquals(await getLatestDrenvVersion(kv), "0.6.0");
    });
  });

  describe("when the cache is stale", () => {
    beforeEach(async () => {
      await kv.set(["drenv", "latestVersion"], {
        version: "0.5.0",
        checkedAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      stubFetch(
        new Response(JSON.stringify({ tag_name: "v0.7.0" }), { status: 200 }),
      );
    });

    it("refetches and updates the cache", async () => {
      assertEquals(await getLatestDrenvVersion(kv), "0.7.0");

      const stored = (await kv.get(["drenv", "latestVersion"])).value as
        | { version: string }
        | null;
      assertEquals(stored?.version, "0.7.0");
    });
  });

  describe("when the cache is stale and fetch fails", () => {
    beforeEach(async () => {
      await kv.set(["drenv", "latestVersion"], {
        version: "0.5.0",
        checkedAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      stubFetchReject(new Error("offline"));
    });

    it("returns the stale cached value", async () => {
      assertEquals(await getLatestDrenvVersion(kv), "0.5.0");
    });
  });

  describe("when there is no cache and fetch fails", () => {
    beforeEach(() => {
      stubFetchReject(new Error("offline"));
    });

    it("returns undefined", async () => {
      assertEquals(await getLatestDrenvVersion(kv), undefined);
    });
  });
});
