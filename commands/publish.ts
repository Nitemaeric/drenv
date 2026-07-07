import { runDragonrubyPublish } from "../utils/dragonruby-publish.ts";

/** Verifies dependencies against the lockfile, then publishes with dragonruby-publish. */
export default function publish(forwarded: string[] = []): Promise<void> {
  return runDragonrubyPublish(forwarded);
}
