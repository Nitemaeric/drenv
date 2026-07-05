import { promptSecret } from "@std/cli";
import ora, { type Ora } from "ora";

import register from "./register.ts";
import { homePath } from "../constants.ts";
import { makeDrenvTempDir } from "../utils/temp.ts";
import { type Tier, validateTier } from "../utils/tier.ts";

const DRAGONRUBY_GAME_ID = 404609;
const ITCH_API = "https://api.itch.io";

// Token found in the itch upload filename for each platform, e.g.
// `dragonruby-gtk-macos.zip` or `dragonruby-gtk-pro-linux-amd64.zip`.
const platformToken: Record<string, string> = {
  "x86_64-pc-windows-msvc": "windows-amd64",
  "x86_64-apple-darwin": "macos",
  "aarch64-apple-darwin": "macos",
  "x86_64-unknown-linux-gnu": "linux-amd64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
};

/** Resolves the tier from the flag, the persisted choice, or an interactive prompt. */
const resolveTier = async (kv: Deno.Kv, flag?: string): Promise<Tier> => {
  if (flag) return validateTier(flag);

  const persisted = (await kv.get<Tier>(["dragonruby", "tier"])).value;
  if (persisted) return persisted;

  const answer = prompt(
    "drenv: Which DragonRuby tier do you own? (standard/indie/pro) [standard]",
  ) ??
    "";
  return validateTier(answer.trim() || "standard");
};

/** Whether an upload filename belongs to the given tier. */
export const matchesTier = (filename: string, tier: Tier): boolean => {
  const name = filename.toLowerCase();
  if (tier === "pro") return name.includes("pro");
  if (tier === "indie") return name.includes("indie");
  return !name.includes("pro") && !name.includes("indie");
};

async function itchLogin(username: string, password: string): Promise<string> {
  const res = await fetch(`${ITCH_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, source: "desktop" }),
  });

  const data = await res.json();

  if (data.errors) {
    throw new Error(`drenv: itch.io login failed: ${data.errors.join(", ")}`);
  }

  if (data.recaptchaNeeded) {
    throw new Error(
      "drenv: itch.io is requesting a CAPTCHA — try logging in via the itch app first",
    );
  }

  if (data.totpNeeded) {
    const code = prompt("Enter your 2FA code:") ?? "";

    const totpRes = await fetch(`${ITCH_API}/totp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: data.token, code }),
    });

    const totpData = await totpRes.json();

    if (totpData.errors) {
      throw new Error(
        `drenv: 2FA verification failed: ${totpData.errors.join(", ")}`,
      );
    }

    return totpData.key.key;
  }

  return data.key.key;
}

async function authenticate(kv: Deno.Kv, spinner: Ora): Promise<string> {
  spinner.stop();
  const username = prompt("itch.io username or email:") ?? "";
  const password = promptSecret("itch.io password:") ?? "";
  spinner.start("Signing into itch.io");

  const apiKey = await itchLogin(username, password);
  await kv.set(["itch", "apiKey"], apiKey);
  return apiKey;
}

async function getDownloadKeyId(apiKey: string): Promise<number> {
  const res = await fetch(`${ITCH_API}/profile/owned-keys`, {
    headers: { "Authorization": apiKey },
  });

  const data = await res.json();

  if (data.errors) {
    throw new Error(
      `drenv: could not fetch owned keys: ${data.errors.join(", ")}`,
    );
  }

  const entry = data.owned_keys?.find(
    (k: { game_id: number }) => k.game_id === DRAGONRUBY_GAME_ID,
  );

  if (!entry) {
    throw new Error(
      "drenv: no DragonRuby GTK purchase found on this itch.io account",
    );
  }

  return entry.id;
}

async function getUpload(
  apiKey: string,
  downloadKeyId: number,
  tier: Tier,
): Promise<{ id: number; filename: string }> {
  const res = await fetch(
    `${ITCH_API}/games/${DRAGONRUBY_GAME_ID}/uploads?download_key_id=${downloadKeyId}`,
    { headers: { "Authorization": apiKey } },
  );

  const data = await res.json();

  if (data.errors) {
    throw new Error(
      `drenv: could not list uploads: ${data.errors.join(", ")}`,
    );
  }

  const uploads: { id: number; filename: string }[] = Array.isArray(
      data.uploads,
    )
    ? data.uploads
    : Object.values(data.uploads);

  const token = platformToken[Deno.build.target];
  if (!token) {
    throw new Error(`drenv: unsupported platform (${Deno.build.target})`);
  }

  const upload = uploads.find((u) =>
    u.filename.includes(token) && matchesTier(u.filename, tier)
  );

  if (!upload) {
    throw new Error(
      `drenv: no ${tier} download found for your platform — available: ${
        uploads.map((u) => u.filename).join(", ") || "none"
      }`,
    );
  }

  return upload;
}

async function downloadUpload(
  apiKey: string,
  uploadId: number,
  downloadKeyId: number,
  destPath: string,
): Promise<void> {
  const redirectRes = await fetch(
    `${ITCH_API}/uploads/${uploadId}/download?download_key_id=${downloadKeyId}`,
    { headers: { "Authorization": apiKey }, redirect: "manual" },
  );

  const downloadUrl = redirectRes.headers.get("location");

  if (!downloadUrl) {
    throw new Error("drenv: failed to get download URL from itch.io");
  }

  const fileRes = await fetch(downloadUrl);

  if (!fileRes.ok || !fileRes.body) {
    throw new Error(`drenv: download failed with status ${fileRes.status}`);
  }

  const file = await Deno.create(destPath);
  await fileRes.body.pipeTo(file.writable);
}

// dragonruby.org's platform token in download_<tier>_subscription_<token>.
// Link keys like `pro_linux_amd64` map to `download_*_subscription_linux` — see
// https://dragonruby.org/api.
export const drOrgPlatform: Record<string, string> = {
  "x86_64-pc-windows-msvc": "windows",
  "x86_64-apple-darwin": "mac",
  "aarch64-apple-darwin": "mac",
  "x86_64-unknown-linux-gnu": "linux",
  "aarch64-unknown-linux-gnu": "pi",
};

/** Downloads the standard tier from itch.io. Returns the register message. */
async function installFromItch(kv: Deno.Kv, spinner: Ora): Promise<string> {
  let apiKey: string = (await kv.get(["itch", "apiKey"])).value as string;

  if (!apiKey) {
    apiKey = await authenticate(kv, spinner);
  }

  spinner.text = "Finding DragonRuby GTK download key...";
  let downloadKeyId: number;
  try {
    downloadKeyId = await getDownloadKeyId(apiKey);
  } catch {
    // Cached key may be expired — re-authenticate and retry once
    apiKey = await authenticate(kv, spinner);
    downloadKeyId = await getDownloadKeyId(apiKey);
  }

  const upload = await getUpload(apiKey, downloadKeyId, "standard");

  spinner.text = `Downloading ${upload.filename}...`;
  const tmp = await makeDrenvTempDir("drenv-download-");
  try {
    const zipPath = `${tmp}/${upload.filename}`;
    await downloadUpload(apiKey, upload.id, downloadKeyId, zipPath);

    spinner.text = "Installing...";
    return await register(zipPath);
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

/** Downloads a subscription tier (indie/pro) from dragonruby.org. */
async function installFromDragonRubyOrg(
  kv: Deno.Kv,
  tier: Tier,
  spinner: Ora,
): Promise<string> {
  const platform = drOrgPlatform[Deno.build.target];
  if (!platform) {
    throw new Error(`drenv: unsupported platform (${Deno.build.target})`);
  }

  // Basic-auth endpoint returns the download URL as its body.
  const endpoint =
    `https://dragonruby.org/api/download_${tier}_subscription_${platform}`;

  // Reuse the cached email; only ever prompt for the password. On an auth
  // failure, forget the email and re-prompt both once so a stale email can't
  // trap the user.
  let email = (await kv.get<string>(["dragonruby", "email"])).value ??
    undefined;
  let downloadUrl: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    spinner.stop();
    if (!email) email = (prompt("dragonruby.org email:") ?? "").trim();
    const password =
      promptSecret(`dragonruby.org password${email ? ` (${email})` : ""}:`) ??
        "";
    spinner.start(`Fetching ${tier} download...`);

    const res = await fetch(endpoint, {
      headers: { "Authorization": `Basic ${btoa(`${email}:${password}`)}` },
    });

    if (res.ok) {
      downloadUrl = (await res.text()).trim();
      await kv.set(["dragonruby", "email"], email);
      break;
    }

    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      email = undefined;
      continue;
    }

    throw new Error(
      res.status === 401 || res.status === 403
        ? "drenv: dragonruby.org login failed — check your email and password"
        : `drenv: dragonruby.org request failed with status ${res.status}`,
    );
  }

  if (!downloadUrl) {
    throw new Error("drenv: dragonruby.org login failed");
  }

  spinner.text = `Downloading ${tier} DragonRuby...`;
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok || !fileRes.body) {
    throw new Error(`drenv: download failed with status ${fileRes.status}`);
  }

  const tmp = await makeDrenvTempDir("drenv-download-");
  try {
    const destPath = `${tmp}/dragonruby-${tier}-${platform}.zip`;
    const file = await Deno.create(destPath);
    await fileRes.body.pipeTo(file.writable);

    spinner.text = "Installing...";
    return await register(destPath, { tier });
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

export default async function install(options: { tier?: string } = {}) {
  const kv = await Deno.openKv(homePath + "/database.db");

  try {
    const tier = await resolveTier(kv, options.tier);
    const spinner = ora({ discardStdin: false }).start(
      `Installing DragonRuby (${tier})`,
    );

    try {
      const message = tier === "standard"
        ? await installFromItch(kv, spinner)
        : await installFromDragonRubyOrg(kv, tier, spinner);

      // Remember the tier so future installs don't re-prompt.
      await kv.set(["dragonruby", "tier"], tier);

      spinner.succeed(message);
    } catch (err) {
      spinner.fail((err as Error).message);
    } finally {
      spinner.stop();
    }
  } finally {
    kv.close();
  }
}
