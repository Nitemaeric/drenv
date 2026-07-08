import { exists } from "@std/fs";

import { findProject } from "../utils/project.ts";
import {
  type DependencySpec,
  readManifest,
  sourceKind,
} from "../utils/manifest.ts";
import { readLock } from "../utils/lockfile.ts";

/** A `kind:value` description of a dependency's source, with any pin. */
export const describeSource = (spec: DependencySpec): string => {
  const kind = sourceKind(spec);
  const pin = spec.tag
    ? `@${spec.tag}`
    : spec.branch
    ? `#${spec.branch}`
    : spec.ref
    ? `@${spec.ref}`
    : "";
  return `${kind}:${spec[kind]}${pin}`;
};

const shortRef = (ref: string | undefined): string =>
  ref ? ref.slice(0, 7) : "—";

export default async function list() {
  const project = await findProject();

  if (!await exists(project.manifestPath)) {
    throw new Error(
      "drenv: no mygame/drenv.toml — add a dependency with `drenv add <source>`",
    );
  }

  const manifest = await readManifest(project.manifestPath);
  if (manifest.dependencies.length === 0) {
    return "drenv: no dependencies declared";
  }

  const lock = await readLock(project.lockPath);

  const rows = manifest.dependencies.map((spec) => ({
    name: spec.name,
    source: describeSource(spec),
    ref: shortRef(
      lock?.dependencies.find((dep) => dep.name === spec.name)?.ref,
    ),
    via: "",
  }));

  // Transitive dependencies live only in the lock; annotate their parents.
  for (const dep of lock?.dependencies ?? []) {
    if (dep.via?.length && !rows.some((row) => row.name === dep.name)) {
      rows.push({
        name: dep.name,
        source: dep.source,
        ref: shortRef(dep.ref),
        via: `via ${dep.via.join(", ")}`,
      });
    }
  }

  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const sourceWidth = Math.max(...rows.map((row) => row.source.length));

  for (const row of rows) {
    console.log(
      `  ${row.name.padEnd(nameWidth)}  ${
        row.source.padEnd(sourceWidth)
      }  ${row.ref}${row.via ? `  ${row.via}` : ""}`,
    );
  }
}
