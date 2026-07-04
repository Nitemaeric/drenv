import { join } from "@std/path";

import { findProject } from "../utils/project.ts";
import { readVersion } from "../utils/read-version.ts";

export default async function version(): Promise<string> {
  const project = await findProject();
  const current = await readVersion(join(project.root, "CHANGELOG-CURR.txt"));

  if (!current) {
    throw new Error(
      "drenv: couldn't determine the project's DragonRuby version",
    );
  }

  return current;
}
