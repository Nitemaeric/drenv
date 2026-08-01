import { join } from "@std/path";

import {
  askTemplate,
  PRIVATE_GITIGNORE,
  PUBLIC_GITIGNORE,
} from "../utils/gitignore.ts";
import { findProject } from "../utils/project.ts";

type GitignoreOptions = {
  public?: boolean;
  private?: boolean;
};

export default async function gitignore(options: GitignoreOptions = {}) {
  if (options.public && options.private) {
    throw new Error("drenv: --public and --private are mutually exclusive");
  }

  const project = await findProject();
  const dest = join(project.root, ".gitignore");

  const exists = await Deno.stat(dest).then(
    () => true,
    () => false,
  );
  if (exists) {
    const answer = prompt(
      "drenv: .gitignore already exists — overwrite? y/N (N)",
    );
    if (!(answer ?? "").trim().toLowerCase().startsWith("y")) {
      return "drenv: cancelled — existing .gitignore left untouched";
    }
  }

  let template: string;
  let label: string;
  if (options.public) {
    [template, label] = [PUBLIC_GITIGNORE, "public"];
  } else if (options.private) {
    [template, label] = [PRIVATE_GITIGNORE, "private"];
  } else {
    template = askTemplate();
    label = template === PUBLIC_GITIGNORE ? "public" : "private";
  }
  await Deno.writeTextFile(dest, template);

  return `drenv: Wrote .gitignore (${label} repository template)`;
}
