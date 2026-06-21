import { findProject } from "../utils/project.ts";
import { bundle as runBundle } from "../utils/bundler.ts";
import { BUNDLE_REQUIRE } from "../utils/bundle-file.ts";

export default async function bundle() {
  const project = await findProject();

  const { lock, needsRequireLine } = await runBundle(project, {
    log: (message) => console.log(message),
  });

  const count = lock.dependencies.length;
  console.log(
    `drenv: bundled ${count} ${count === 1 ? "dependency" : "dependencies"}`,
  );

  if (needsRequireLine && count > 0) {
    console.log(
      `\nAdd this line to the top of mygame/app/main.rb to load them:\n  ${BUNDLE_REQUIRE}`,
    );
  }
}
