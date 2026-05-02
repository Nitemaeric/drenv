import { homePath } from "../constants.ts";

const RELEASES_URL =
  "https://api.github.com/repos/nitemaeric/drenv/releases/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

type CachedVersion = { version: string; checkedAt: number };

export const fetchLatestDrenvVersion = async (): Promise<
  string | undefined
> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(RELEASES_URL, { signal: controller.signal });
    if (!res.ok) return undefined;

    const data = await res.json();
    const tag = data.tag_name as string | undefined;
    if (!tag) return undefined;

    const version = tag.startsWith("v") ? tag.slice(1) : tag;
    return /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

export const getLatestDrenvVersion = async (
  kv?: Deno.Kv,
): Promise<string | undefined> => {
  const ownsKv = !kv;
  try {
    kv ??= await Deno.openKv(homePath + "/database.db");

    const cached = (await kv.get(["drenv", "latestVersion"])).value as
      | CachedVersion
      | null;

    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      return cached.version;
    }

    const version = await fetchLatestDrenvVersion();
    if (!version) return cached?.version;

    await kv.set(
      ["drenv", "latestVersion"],
      {
        version,
        checkedAt: Date.now(),
      } satisfies CachedVersion,
    );

    return version;
  } catch {
    return undefined;
  } finally {
    if (ownsKv && kv) kv.close();
  }
};
