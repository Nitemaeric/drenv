import { greaterThan, parse } from "jsr:@std/semver";

import { program } from "../main.ts";
import { drenvBinPath, version } from "../constants.ts";

type Asset = {
  url: string;
  id: number;
  node_id: string;
  name: string;
  label: string | null;
  uploader: any;
  content_type: string;
  state: string;
  size: number;
  download_count: number;
  created_at: string;
  updated_at: string;
  browser_download_url: string;
};

export default async function upgrade() {
  console.log(`Current version is v${program.version()}`);
  console.log("Checking for updates...");

  const dataResponse = await fetch(
    "https://api.github.com/repos/nitemaeric/drenv/releases/latest",
  );
  const data = await dataResponse.json();

  const localVersion = parse(version);
  const remoteVersion = parse(data.tag_name.slice(1));

  if (greaterThan(remoteVersion, localVersion)) {
    console.log(`New version found: ${data.tag_name}`);

    const file = await Deno.open(drenvBinPath, { write: true, create: true });

    const targetAsset = data.assets.find((asset: Asset) =>
      asset.name.includes(Deno.build.target)
    );

    if (targetAsset) {
      console.log(`Downloading new version...`);

      const downloadResponse = await fetch(targetAsset.browser_download_url);

      if (!downloadResponse.body) {
        throw new Error("Could not download the new version");
      }

      await downloadResponse.body.pipeTo(file.writable);
      await Deno.chmod(drenvBinPath, 0o755);

      console.log(`Upgraded to ${data.tag_name}`);
    } else {
      console.log("No asset found for your platform");
    }
  } else {
    console.log("Already up-to-date");
  }
}
