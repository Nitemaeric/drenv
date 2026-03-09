import { promptSecret } from "@std/cli";
import { ensureDir } from "@std/fs";
import ora, { type Ora } from "ora";

import register from "./register.ts";
import { homePath } from "../constants.ts";

const DRAGONRUBY_GAME_ID = 404609;
const ITCH_API = "https://api.itch.io";

const buildTargetLookup: Record<string, string> = {
  "x86_64-pc-windows-msvc": "dragonruby-gtk-windows-amd64.zip",
  "x86_64-apple-darwin": "dragonruby-gtk-macos.zip",
  "aarch64-apple-darwin": "dragonruby-gtk-macos.zip",
  "x86_64-unknown-linux-gnu": "dragonruby-gtk-linux-amd64.zip",
  "aarch64-unknown-linux-gnu": "dragonruby-gtk-linux-arm64.zip",
};

const downloadName = buildTargetLookup[Deno.build.target];

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

async function getUploadId(
  apiKey: string,
  downloadKeyId: number,
): Promise<number> {
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

  const upload = uploads.find((u) => u.filename === downloadName);

  if (!upload) {
    throw new Error(`drenv: no upload found for platform (${downloadName})`);
  }

  return upload.id;
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

  await ensureDir("./tmp");
  const file = await Deno.create(destPath);
  await fileRes.body.pipeTo(file.writable);
}

export default async function install(tier: string = "standard") {
  if (tier !== "standard") {
    throw new Error("drenv: Only the standard tier is supported at this time");
  }

  const kv = await Deno.openKv(homePath + "/database.db");
  let apiKey: string = (await kv.get(["itch", "apiKey"])).value as string;

  const spinner = ora({ discardStdin: false }).start("Signing into itch.io");

  try {
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

    spinner.text = `Downloading ${downloadName}...`;
    const [uploadId] = await Promise.all([
      getUploadId(apiKey, downloadKeyId),
      ensureDir("./tmp"),
    ]);

    await downloadUpload(apiKey, uploadId, downloadKeyId, `./tmp/${downloadName}`);

    spinner.text = "Installing...";
    const message = await register(`./tmp/${downloadName}`);
    spinner.succeed(message);
  } catch (err) {
    spinner.fail((err as Error).message);
  } finally {
    spinner.stop();
    kv.close();
  }
}
