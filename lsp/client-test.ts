// Scripted LSP client for the spike: drives a server binary over stdio and
// asserts the core surface works. Usage:
//   deno run -A lsp/client-test.ts <command> [args...]
// e.g. deno run -A lsp/client-test.ts deno run -A main.ts lsp
//      deno run -A lsp/client-test.ts ./builds/drenv lsp
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { toFileUrl } from "@std/path";

const [cmd, ...args] = Deno.args;
if (!cmd) {
  console.error("usage: client-test.ts <server command...>");
  Deno.exit(2);
}

// --- fixture project ---------------------------------------------------------

const tmp = await Deno.makeTempDir({ prefix: "drenv-lsp-client-" });
const mygame = join(tmp, "mygame");
await ensureDir(join(mygame, "app"));
await ensureDir(join(mygame, "vendor", "dragon_input"));

const MAIN = `def tick args
  args.outputs.labels << { x: 100, y: 100, text: "hi" }
  spawn_enemy args
  Geometry.nope(args)
  Geometry.
end

def spawn_enemy args
  args.state.enemies ||= []
end

def core_demo
  [1, 2].
end
`;
await Deno.writeTextFile(join(mygame, "app", "main.rb"), MAIN);
await Deno.writeTextFile(
  join(mygame, "vendor", "dragon_input", "dragon_input.rb"),
  "module DragonInput\n  def self.pressed?(pad, action)\n  end\nend\n",
);

const mainUri = toFileUrl(join(mygame, "app", "main.rb")).href;

// --- minimal client ----------------------------------------------------------

const proc = new Deno.Command(cmd, {
  args,
  cwd: tmp,
  stdin: "piped",
  stdout: "piped",
  stderr: "inherit",
}).spawn();

const writer = proc.stdin.getWriter();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let nextId = 1;
let buffer = new Uint8Array(0);
const pending = new Map<number, (result: unknown) => void>();
const notifications: { method: string; params: unknown }[] = [];

const pump = (async () => {
  for await (const chunk of proc.stdout) {
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;

    while (true) {
      const text = decoder.decode(buffer);
      const headerEnd = text.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const length = Number(text.match(/Content-Length: (\d+)/i)?.[1] ?? 0);
      const bodyStart =
        new TextEncoder().encode(text.slice(0, headerEnd + 4)).length;
      if (buffer.length < bodyStart + length) break;

      const body = JSON.parse(
        decoder.decode(buffer.slice(bodyStart, bodyStart + length)),
      );
      buffer = buffer.slice(bodyStart + length);

      if (body.id !== undefined && pending.has(body.id)) {
        pending.get(body.id)!(body.result);
        pending.delete(body.id);
      } else if (body.method) {
        notifications.push({ method: body.method, params: body.params });
      }
    }
  }
})();

const send = async (message: unknown) => {
  const body = encoder.encode(JSON.stringify(message));
  await writer.write(encoder.encode(`Content-Length: ${body.length}\r\n\r\n`));
  await writer.write(body);
};

const request = (method: string, params: unknown): Promise<unknown> => {
  const id = nextId++;
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000);
  });
  send({ jsonrpc: "2.0", id, method, params });
  return promise;
};

const notify = (method: string, params: unknown) =>
  send({ jsonrpc: "2.0", method, params });

// --- the script ----------------------------------------------------------------

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// deno-lint-ignore no-explicit-any
const init: any = await request("initialize", {
  processId: null,
  rootUri: toFileUrl(tmp).href,
  capabilities: {},
});
check("initialize", !!init?.capabilities?.completionProvider);

await notify("initialized", {});
await notify("textDocument/didOpen", {
  textDocument: { uri: mainUri, languageId: "ruby", version: 1, text: MAIN },
});

// Give diagnostics a beat to arrive.
await new Promise((r) => setTimeout(r, 500));
const diag = notifications.find(
  (n) => n.method === "textDocument/publishDiagnostics",
);
// deno-lint-ignore no-explicit-any
const diags: any[] = (diag?.params as any)?.diagnostics ?? [];
check(
  "diagnostics: syntax error surfaced (Geometry. dangling)",
  diags.some((d) => d.message.includes("syntax error")),
  `${diags.length} diagnostic(s)`,
);
check(
  "diagnostics: method validity (Geometry.nope flagged)",
  diags.some((d) => d.message.includes("`nope` is not a method on Geometry")),
);

// Completion after `Geometry.` (line 3, character 11 — right after the dot).
// deno-lint-ignore no-explicit-any
const completion: any = await request("textDocument/completion", {
  textDocument: { uri: mainUri },
  position: { line: 4, character: 11 },
});
const labels = (completion ?? []).map((c: { label: string }) => c.label);
check(
  "completion: Geometry. lists engine methods",
  labels.includes("intersect_rect?") || labels.includes("distance"),
  `${labels.length} items, e.g. ${labels.slice(0, 4).join(", ")}`,
);

// deno-lint-ignore no-explicit-any
const argsCompletion: any = await request("textDocument/completion", {
  textDocument: { uri: mainUri },
  position: { line: 1, character: 7 }, // after "args."
});
const argLabels = (argsCompletion ?? []).map((c: { label: string }) => c.label);
check(
  "completion: args. lists engine chains",
  argLabels.includes("outputs") && argLabels.includes("state"),
  argLabels.slice(0, 6).join(", "),
);

// Core methods on a literal receiver: `[1, 2].` (line 11, after the dot).
// deno-lint-ignore no-explicit-any
const coreCompletion: any = await request("textDocument/completion", {
  textDocument: { uri: mainUri },
  position: { line: 12, character: 9 },
});
const coreLabels = (coreCompletion ?? []).map((c: { label: string }) =>
  c.label
);
check(
  "completion: [].each — mruby core methods on literal receivers",
  coreLabels.includes("each") && coreLabels.includes("map"),
  `${coreLabels.length} items`,
);

// Engine markdown docs flow through: map_2d is a DragonRuby Array extension
// that only exists in docs/api/array.md, and its docs ride the completion.
const map2d = (coreCompletion ?? []).find(
  (c: { label: string }) => c.label === "map_2d",
);
check(
  "docs: DR Array extension surfaced from docs/api/array.md",
  !!map2d,
);
check(
  "docs: real markdown attached to completions",
  (map2d?.documentation?.value ?? "").length > 50,
  `${map2d?.documentation?.value?.length ?? 0} chars`,
);

// Hover over a workspace def (spawn_enemy call on line 2, col 3).
// deno-lint-ignore no-explicit-any
const hoverResult: any = await request("textDocument/hover", {
  textDocument: { uri: mainUri },
  position: { line: 2, character: 4 },
});
check(
  "hover: workspace def",
  (hoverResult?.contents?.value ?? "").includes("spawn_enemy"),
);

// Definition of spawn_enemy from its call site.
// deno-lint-ignore no-explicit-any
const def: any = await request("textDocument/definition", {
  textDocument: { uri: mainUri },
  position: { line: 2, character: 4 },
});
check(
  "definition: jumps to def spawn_enemy",
  Array.isArray(def) && def.length === 1 && def[0].range.start.line === 7,
  JSON.stringify(def?.[0]?.range?.start),
);

// Definition of a vendored library symbol.
// deno-lint-ignore no-explicit-any
const refs: any = await request("textDocument/references", {
  textDocument: { uri: mainUri },
  position: { line: 2, character: 4 },
});
check(
  "references: finds call site + definition",
  Array.isArray(refs) && refs.length >= 2,
  `${refs?.length} reference(s)`,
);

await request("shutdown", null);
await notify("exit", null);
await pump.catch(() => {});
await Deno.remove(tmp, { recursive: true }).catch(() => {});

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILED`);
Deno.exit(failures === 0 ? 0 : 1);
