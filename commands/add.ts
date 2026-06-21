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
  const name = options.name ?? deriveName(parsed);

  const dep: DependencySpec = {
    name,
    entrypoint: options.entrypoint,
    tag: options.tag ?? parsed.tag,
    branch: options.branch,
    ref: options.ref,
  };
  dep[parsed.kind] = parsed.value;

  if (parsed.kind !== "url" && !dep.entrypoint) {
    throw new Error(
      `drenv: ${parsed.kind} dependencies need an entrypoint (pass -e <file>)`,
    );
  }

  const project = await findProject(Deno.cwd(), { requireManifest: false });

  // Guard against duplicates before touching the manifest.
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
