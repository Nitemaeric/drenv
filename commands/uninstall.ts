import { versionsPath } from "../constants.ts";
import { resolveVersionDir } from "../utils/installed-versions.ts";
import { versionLabel } from "../utils/tier.ts";

export class NotInstalled extends Error {
  version: string;

  constructor(version: string) {
    super(`drenv: version '${version}' not installed`);

    this.name = "NotInstalled";
    this.version = version;
  }
}

export default async function uninstall(
  version: string,
  options: { yes?: boolean } = {},
) {
  // Bare input resolves to the highest installed tier; a suffix pins it. The
  // prompt shows the resolved version+tier so a destructive delete is explicit.
  const dir = await resolveVersionDir(version);
  if (!dir) {
    throw new NotInstalled(version);
  }

  const label = versionLabel(dir);
  if (!options.yes) {
    const answer = prompt(`drenv: Uninstall version ${label}? y/N (N)`) ?? "";
    if (!answer.trim().toLowerCase().startsWith("y")) {
      return "drenv: cancelled";
    }
  }

  await Deno.remove(`${versionsPath}/${dir}`, { recursive: true });

  return `drenv: Uninstalled ${label}`;
}
