import { relative } from "@std/path";

import config from "../deno.json" with { type: "json" };
import { installedVersions } from "../utils/installed-versions.ts";
import { Ruby } from "./src/ruby.ts";
import { EngineIndex } from "./src/engine.ts";
import { detectProjectDirs, detectWorkspaceEngine } from "./src/workspace.ts";

const OK = "✓"; //  ✓
const WARN = "⚠"; // ⚠
const BAD = "✗"; //  ✗
const DOT = "·"; //  ·

const rel = (from: string, to: string): string => {
  const r = relative(from, to);
  return r === "" ? "." : r;
};

// Best-effort "is this command on PATH" — the editors resolve the server by
// name, so a missing PATH entry is the most common reason it never starts.
const onPath = async (cmd: string): Promise<string | null> => {
  const finder = Deno.build.os === "windows" ? "where" : "which";
  try {
    const { success, stdout } = await new Deno.Command(finder, {
      args: [cmd],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!success) return null;
    const first = new TextDecoder().decode(stdout).split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
};

export default async function doctor(): Promise<void> {
  const out: string[] = [];
  const root = Deno.cwd();

  // --- drenv itself ---------------------------------------------------------
  out.push(`drenv v${config.version} — language server diagnostics\n`);
  const drenvPath = await onPath("drenv");
  out.push(
    drenvPath
      ? `  ${OK} \`drenv\` on PATH (${drenvPath})`
      : `  ${WARN} \`drenv\` is not on PATH — editors launch the server by ` +
        `name, so add ~/.drenv/bin to your PATH`,
  );

  // --- project detection (mirrors the server's initialize) ------------------
  const roots = await detectProjectDirs(root);
  out.push(`\nProject — ${root}`);
  if (roots.length === 0) {
    out.push(
      `  ${WARN} no DragonRuby project detected here; the server stays ` +
        `dormant.\n      Needs \`dragonruby\`, \`dragonruby.exe\`, or ` +
        `\`mygame\` at the root or one level down, or a root \`drenv.toml\`.`,
    );
    out.push(`\n(nothing else to check while dormant)`);
    console.log(out.join("\n"));
    return;
  }
  out.push(`  ${OK} DragonRuby project detected`);
  for (const dir of roots) out.push(`      ${DOT} indexes ${rel(root, dir)}/`);

  // --- engine resolution ----------------------------------------------------
  out.push(`\nEngine`);
  const ruby = await Ruby.init();
  const wsEngine = await detectWorkspaceEngine(root, roots);
  let index: EngineIndex | null = null;
  if (wsEngine) {
    index = await EngineIndex.build(ruby, { rootDir: wsEngine });
    out.push(
      `  ${OK} in-workspace engine at ${rel(root, wsEngine)}/ ` +
        `(DragonRuby ${index.label})`,
    );
  } else {
    const versions = await installedVersions();
    if (versions.length === 0) {
      out.push(
        `  ${BAD} no engine found — run \`drenv install\`.\n      ` +
          `Completions, hover, and diagnostics need one; workspace features ` +
          `(your defs, vendored libs) still work.`,
      );
    } else {
      index = await EngineIndex.build(ruby);
      out.push(
        `  ${OK} drenv-managed engine: DragonRuby ${index.label} ` +
          `(newest of ${versions.length} installed)`,
      );
    }
  }
  if (index && index.api.size > 0) {
    out.push(
      `      ${DOT} ${index.api.size} API namespaces indexed ` +
        `(Geometry, Easing, args.*)`,
    );
  }

  // --- editors --------------------------------------------------------------
  out.push(`\nEditors`);
  const editors: [string, string, string][] = [
    ["Zed", "zed", "install the drenv extension (dev extension for now)"],
    ["VS Code", "code", "install `nitemaeric.drenv-lsp` from the Marketplace"],
    ["Neovim", "nvim", "see editors/nvim/README.md"],
    ["Emacs", "emacs", "see editors/emacs/README.md"],
  ];
  const found: string[] = [];
  for (const [label, cmd, hint] of editors) {
    if (await onPath(cmd)) found.push(`  ${OK} ${label} — ${hint}`);
  }
  if (found.length > 0) out.push(...found);
  else {out.push(
      `  ${DOT} no editor CLI found on PATH — setup at ` +
        `https://drenv.org/docs/lsp`,
    );}

  console.log(out.join("\n"));
}
