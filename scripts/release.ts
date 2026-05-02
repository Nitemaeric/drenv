import config from "../deno.json" with { type: "json" };

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const fail = (message: string): never => {
  console.error(message);
  Deno.exit(1);
};

const run = async (cmd: string, args: string[]) => {
  const { success } = await new Deno.Command(cmd, {
    args,
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!success) {
    fail(`drenv: \`${cmd} ${args.join(" ")}\` failed`);
  }
};

const capture = async (cmd: string, args: string[]) => {
  const { stdout } = await new Deno.Command(cmd, { args }).output();
  return new TextDecoder().decode(stdout).trim();
};

const [version] = Deno.args;

if (!version || !VERSION_PATTERN.test(version)) {
  fail("Usage: deno task release <X.Y.Z>");
}

if (version === config.version) {
  fail(`drenv: deno.json is already on version ${version}`);
}

const branch = await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  fail(`drenv: refusing to release from branch \`${branch}\` (must be main)`);
}

const status = await capture("git", ["status", "--porcelain"]);
if (status) {
  fail("drenv: working tree is not clean — commit or stash changes first");
}

const denoJsonPath = new URL("../deno.json", import.meta.url);
const original = await Deno.readTextFile(denoJsonPath);
const updated = original.replace(
  /"version":\s*"[^"]+"/,
  `"version": "${version}"`,
);

if (updated === original) {
  fail("drenv: failed to rewrite version field in deno.json");
}

await Deno.writeTextFile(denoJsonPath, updated);

await run("git", ["add", "deno.json"]);
await run("git", ["commit", "-m", `Bump to version v${version}`]);
await run("git", ["tag", `v${version}`]);
await run("git", ["push", "origin", "main", `v${version}`]);

console.log(`drenv: released v${version}`);
