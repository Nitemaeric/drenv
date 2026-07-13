import denoConfig from "../../deno.json" with { type: "json" };

// The site's version badge should track the latest *release*, not whatever
// deno.json happened to be inlined at the last deploy. A release bumps
// deno.json but doesn't necessarily redeploy the site (Deno Deploy rebuilds on
// website changes, and a version bump touches only the repo root), so a
// build-time constant lags a release behind. Fetch the released tag at render
// time instead, cached in-isolate, with the built-in version as a fallback.

let cache: { value: string; expires: number } | null = null;
const TTL_MS = 15 * 60 * 1000;

export async function latestVersion(): Promise<string> {
  if (cache && Date.now() < cache.expires) return cache.value;
  try {
    const res = await fetch(
      "https://api.github.com/repos/Nitemaeric/drenv/releases/latest",
      {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (res.ok) {
      const tag = String((await res.json()).tag_name ?? "");
      const value = tag.replace(/^v/, "") || denoConfig.version;
      cache = { value, expires: Date.now() + TTL_MS };
      return value;
    }
  } catch {
    // network error / timeout / rate limit — fall back to the built-in version
  }
  return denoConfig.version;
}
