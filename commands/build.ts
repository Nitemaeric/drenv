import { runDragonrubyPublish } from "../utils/dragonruby-publish.ts";

/** Packages the project locally with `dragonruby-publish --only-package`. */
export default function build(forwarded: string[] = []): Promise<void> {
  return runDragonrubyPublish(["--only-package", ...forwarded]);
}
