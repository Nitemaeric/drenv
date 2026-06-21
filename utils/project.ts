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
    super("drenv: no mygame/drenv.toml found in this directory or any parent");
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

/**
 * Walks up from `start` looking for a project. A project root is a directory
 * containing `mygame/drenv.toml`; when `start` is inside the `mygame` directory
 * itself, its parent is used.
 */
export const findProject = async (
  start: string = Deno.cwd(),
): Promise<Project> => {
  let dir = resolve(start);

  while (true) {
    if (await exists(join(dir, "mygame", "drenv.toml"))) {
      return project(dir);
    }

    if (basename(dir) === "mygame" && await exists(join(dir, "drenv.toml"))) {
      return project(dirname(dir));
    }

    const parent = dirname(dir);
    if (parent === dir) {
      throw new ProjectNotFound();
    }
    dir = parent;
  }
};
