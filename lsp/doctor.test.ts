import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const MAIN = join(import.meta.dirname!, "..", "main.ts");

const run = async (cwd: string): Promise<string> => {
  const { success, stdout } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--unstable-kv", MAIN, "lsp", "doctor"],
    cwd,
    stdout: "piped",
    stderr: "null",
  }).output();
  assert(success, "doctor should exit 0");
  return new TextDecoder().decode(stdout);
};

// The dormant path needs no engine, so it's CI-safe (no DragonRuby install).
Deno.test("lsp doctor reports dormant in a non-DragonRuby directory", async () => {
  const dir = await Deno.makeTempDir({ prefix: "drenv-doctor-" });
  try {
    const out = await run(dir);
    assertStringIncludes(out, "language server diagnostics");
    assertStringIncludes(out, "no DragonRuby project detected");
    assertStringIncludes(out, "stays dormant");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lsp doctor detects a project and reports engine resolution", async () => {
  const dir = await Deno.makeTempDir({ prefix: "drenv-doctor-" });
  try {
    await Deno.mkdir(join(dir, "mygame", "app"), { recursive: true });
    await Deno.writeTextFile(join(dir, "mygame", "app", "main.rb"), "");
    const out = await run(dir);
    assertStringIncludes(out, "DragonRuby project detected");
    // The engine section renders whether or not a real install is present;
    // with none, it advises `drenv install`.
    assertStringIncludes(out, "Engine");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
