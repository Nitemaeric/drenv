import { exists } from "@std/fs";
import { basename, dirname, join, resolve } from "@std/path";

export type Project = {
  /** Project root — holds the `dragonruby` binary and the `mygame` directory. */
  root: string;
  mygame: string;
  manifestPath: string;
  lockPath: string;
};

export class ProjectNotFound extends Error {
  constructor() {
    super(
      "drenv: no DragonRuby project (mygame/) found in this directory or any parent",
    );
    this.name = "ProjectNotFound";
  }
}

const project = (root: string): Project => {
  const mygame = join(root, "mygame");

  return {
    root,
    mygame,
    manifestPath: join(mygame, "drenv.toml"),
    lockPath: join(mygame, "drenv.lock"),
  };
};

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
};

/**
 * Walks up from `start` looking for a project. By default a project root is a
 * directory containing `mygame/drenv.toml`; with `requireManifest: false` (used
 * by `drenv add`, which creates the manifest) any directory containing a
 * `mygame/` directory qualifies. When `start` is inside `mygame` itself, its
 * parent is used.
 */
export const findProject = async (
  start: string = Deno.cwd(),
  options: { requireManifest?: boolean } = {},
): Promise<Project> => {
  const requireManifest = options.requireManifest ?? true;
  let dir = resolve(start);

  while (true) {
    if (requireManifest) {
      if (await exists(join(dir, "mygame", "drenv.toml"))) {
        return project(dir);
      }
      if (basename(dir) === "mygame" && await exists(join(dir, "drenv.toml"))) {
        return project(dirname(dir));
      }
    } else {
      if (await isDirectory(join(dir, "mygame"))) {
        return project(dir);
      }
      if (basename(dir) === "mygame") {
        return project(dirname(dir));
      }
    }

    const parent = dirname(dir);
    if (parent === dir) {
      throw new ProjectNotFound();
    }
    dir = parent;
  }
};
