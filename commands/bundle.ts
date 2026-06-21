import { findProject } from "../utils/project.ts";
import { bundle as runBundle, reconcile } from "../utils/bundler.ts";
import { BUNDLE_REQUIRE } from "../utils/bundle-file.ts";

export default async function bundle(options: { frozen?: boolean } = {}) {
  const project = await findProject();
  const log = (message: string) => console.log(message);

  const { lock, needsRequireLine } = options.frozen
    ? await reconcile(project, { log, frozen: true })
    : await runBundle(project, { log });

  const count = lock.dependencies.length;
  const verb = options.frozen ? "verified" : "bundled";
  console.log(
    `drenv: ${verb} ${count} ${count === 1 ? "dependency" : "dependencies"}`,
  );

  if (needsRequireLine && count > 0) {
    console.log(
      `\nAdd this line to the top of mygame/app/main.rb to load them:\n  ${BUNDLE_REQUIRE}`,
    );
  }
}
