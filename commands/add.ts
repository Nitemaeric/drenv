import { basename, dirname, relative, resolve } from "@std/path";

import { findProject } from "../utils/project.ts";
import { bundle } from "../utils/bundler.ts";
import { BUNDLE_REQUIRE } from "../utils/bundle-file.ts";
import { type DependencySpec, readManifest } from "../utils/manifest.ts";
import {
  addDependencyToManifest,
  deriveName,
  parseSource,
} from "../utils/manifest-edit.ts";

type AddOptions = {
  name?: string;
  entrypoint?: string;
  tag?: string;
  branch?: string;
  ref?: string;
};

export default async function add(source: string, options: AddOptions = {}) {
  const parsed = parseSource(source);
  const project = await findProject();

  let value = parsed.value;
  let entrypoint = options.entrypoint;
  let name = options.name;

  if (parsed.kind === "path") {
    // The path is typed relative to the shell, but stored relative to the
    // manifest (mygame/). If it points at a file, treat that as the entrypoint.
    const absolute = resolve(Deno.cwd(), value);

    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(absolute);
    } catch {
      throw new Error(
        `drenv: path '${parsed.value}' not found (resolved to ${absolute})`,
      );
    }

    let directory = absolute;
    if (info.isFile) {
      directory = dirname(absolute);
      entrypoint ??= basename(absolute);
      name ??= basename(absolute).replace(/\.[^.]+$/, "");
    }

    value = relative(project.mygame, directory) || ".";
  }

  name ??= deriveName({ kind: parsed.kind, value });

  const dep: DependencySpec = {
    name,
    entrypoint,
    tag: options.tag ?? parsed.tag,
    branch: options.branch,
    ref: options.ref,
  };
  dep[parsed.kind] = value;

  if (parsed.kind !== "url" && !dep.entrypoint) {
    throw new Error(
      `drenv: ${parsed.kind} dependencies need an entrypoint — pass \`-e <file>\`` +
        (parsed.kind === "path"
          ? " or point at the entry file (e.g. drenv add ../lib/conjuration.rb)"
          : ""),
    );
  }

  const existing = await readManifest(project.manifestPath).catch(() => null);
  if (existing?.dependencies.some((d) => d.name === name)) {
    throw new Error(
      `drenv: dependency '${name}' already exists (remove it first, or pass -n)`,
    );
  }

  await addDependencyToManifest(project.manifestPath, dep);

  const { needsRequireLine } = await bundle(project, {
    log: (message) => console.log(message),
  });

  console.log(`drenv: added ${name}`);

  if (needsRequireLine) {
    console.log(
      `\nAdd this line to the top of mygame/app/main.rb to load it:\n  ${BUNDLE_REQUIRE}`,
    );
  }
}
