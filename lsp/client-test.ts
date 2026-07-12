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
  Array.new(3)
  Array.
end

def fx_demo args
  args.state.fx_queue.each do |fx|
    args.state.fx_queue.delete fx
  end
end

def sig_demo
  Geometry.distance({x: 0, y: 0}, {x: 3, y: 4})
  Geometry.rotate_point({x: 0, y: 0})
end

def shape_demo
  Geometry.distance({x: 0}, {x: 3, y: 4})
end

def kwarg_demo
  Geometry.rect_navigate rec: {}
end

# Spawns a wave of enemies at the given difficulty.
#
# @param args [GTK::Args] the tick args
# @param difficulty [Integer] wave scaling factor
# @return [Array] the spawned enemies
# @yield [Integer] each spawned enemy id
# @raise [ArgumentError] if difficulty is negative
# @note Call at most once per tick. Modes:
#   - +:loop+ repeats forever
#   - +:once+ holds the last frame
# @example
#   spawn_wave args, 3
def spawn_wave args, difficulty
end

module Fx
  # Coordinates screen shake.
  #
  # @param intensity [Float] how hard to shake
  class Shaker
    # Builds a shaker.
    #
    # @param intensity [Float] initial strength
    # @return [Shaker] the new shaker
    # @see Fx::Shaker
    def initialize intensity
      @strength = intensity
    end
  end

  class Fader
    # Builds a fader.
    def initialize
    end
  end
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

// Array class-level variants (docs "Array Class Methods" bullet list),
// completed on the constant receiver. Line 14 is `  Array.`.
// deno-lint-ignore no-explicit-any
const classCompletion: any = await request("textDocument/completion", {
  textDocument: { uri: mainUri },
  position: { line: 14, character: 8 },
});
const classLabels = (classCompletion ?? []).map((c: { label: string }) =>
  c.label
);
check(
  "completion: Array. lists class-level variants (filter_map)",
  classLabels.includes("filter_map") && classLabels.includes("map"),
  `${classLabels.length} items`,
);
check(
  "diagnostics: Array.new NOT flagged (validity restricted)",
  !diags.some((d) => d.message.includes("not a method on Array")),
);

// Signature help inside the second argument of Geometry.distance (line 24).
// deno-lint-ignore no-explicit-any
const sig: any = await request("textDocument/signatureHelp", {
  textDocument: { uri: mainUri },
  position: { line: 24, character: 36 },
});
check(
  "signatureHelp: Geometry.distance(point_one, point_two)",
  (sig?.signatures?.[0]?.label ?? "").includes("point_one, point_two") &&
    sig?.signatures?.[0]?.parameters?.length === 2,
  sig?.signatures?.[0]?.label ?? "none",
);
check(
  "signatureHelp: active parameter tracks the cursor",
  sig?.activeParameter === 1,
  `active=${sig?.activeParameter}`,
);

// Arity: rotate_point(point, angle, around = nil) called with 1 argument.
const arity = diags.find((d) => d.message.includes("rotate_point expects"));
check(
  "diagnostics: arity — rotate_point expects 2..3, got 1",
  !!arity && arity.message.includes("2..3") && arity.message.includes("got 1"),
  arity?.message ?? "missing",
);

// Completion detail carries the signature.
const distItem = (completion ?? []).find(
  (c: { label: string }) => c.label === "distance",
);
check(
  "completion: detail shows the signature",
  distItem?.detail === "distance(point_one, point_two)",
  distItem?.detail ?? "none",
);

// Shape verification: derived from the engine body (distance reads .x/.y),
// checked against hash-literal arguments.
const shapes = diags.filter((d) => d.message.includes("is missing `."));
check(
  "diagnostics: shape — {x: 0} missing .y for point_one",
  shapes.length === 1 && shapes[0].message.includes("`point_one`") &&
    shapes[0].message.includes("`.y`"),
  shapes[0]?.message ?? "missing",
);

// Kwarg validation: `rec:` is not a keyword of rect_navigate, and the
// required keywords rect:/rects: are missing.
const badKwarg = diags.find((d) =>
  d.message.includes("`rec:` is not a keyword")
);
check(
  "diagnostics: unknown kwarg rec: names the accepted keywords",
  !!badKwarg && badKwarg.message.includes("rect:") &&
    badKwarg.message.includes("rects:"),
  badKwarg?.message?.slice(0, 90) ?? "missing",
);
const missingKw = diags.find((d) =>
  d.message.includes("missing required keyword")
);
check(
  "diagnostics: missing required keywords rect:, rects:",
  !!missingKw && missingKw.message.includes("`rect:`") &&
    missingKw.message.includes("`rects:`"),
  missingKw?.message?.slice(0, 90) ?? "missing",
);

// YARD docs: hover on the spawn_wave def renders tags as markdown.
const lineOf = (needle: string) =>
  MAIN.split("\n").findIndex((l) => l.includes(needle));
// deno-lint-ignore no-explicit-any
const yardHover: any = await request("textDocument/hover", {
  textDocument: { uri: mainUri },
  position: { line: lineOf("def spawn_wave"), character: 6 },
});
const yardDoc = yardHover?.contents?.value ?? "";
check(
  "yard: hover renders @param/@return/@note/@example as markdown",
  yardDoc.includes("Spawns a wave") &&
    yardDoc.includes("**Parameters**") &&
    yardDoc.includes("`difficulty` (`Integer`)") &&
    yardDoc.includes("**Returns**") &&
    yardDoc.includes("**Raises** (`ArgumentError`)") &&
    yardDoc.includes("> **Note:**") &&
    yardDoc.includes("```ruby"),
  `${yardDoc.length} chars`,
);
check(
  "yard: @note continuation lines stay inside the blockquote (+code+ -> `code`)",
  yardDoc.includes("\n> - `:loop` repeats forever") &&
    yardDoc.includes("\n> - `:once` holds the last frame"),
);

// YARD docs on a class whose comment block tree-attaches to the enclosing
// module node rather than as siblings of the class (the animation.rb shape).
const shakerLine = MAIN.split("\n").findIndex((l) =>
  l.includes("class Shaker")
);
// deno-lint-ignore no-explicit-any
const classHover: any = await request("textDocument/hover", {
  textDocument: { uri: mainUri },
  position: { line: shakerLine, character: 10 },
});
const classDoc = classHover?.contents?.value ?? "";
check(
  "yard: class doc block inside a module renders on hover",
  classDoc.includes("Coordinates screen shake") &&
    classDoc.includes("`intensity` (`Float`)"),
  `${classDoc.length} chars`,
);
check(
  "hover: def site shows the qualified name",
  classDoc.includes("**Fx::Shaker**"),
);

// Same-named defs (initialize): hovering one def must show ITS container and
// ITS doc — not a merged list with an arbitrary winner's doc.
const shakerInitLine = lineOf("def initialize intensity");
// deno-lint-ignore no-explicit-any
const initHover: any = await request("textDocument/hover", {
  textDocument: { uri: mainUri },
  position: { line: shakerInitLine, character: 10 },
});
const initDoc = initHover?.contents?.value ?? "";
check(
  "hover: same-named def resolves to its own container and doc",
  initDoc.includes("**Fx::Shaker#initialize**") &&
    initDoc.includes("Builds a shaker") &&
    !initDoc.includes("Builds a fader"),
  `${initDoc.length} chars`,
);
check(
  "yard: @see renders as a link when the constant is indexed",
  initDoc.includes("_See:_ [`Fx::Shaker`](file://"),
);
check(
  "yard: @yield renders as a Yields section",
  yardDoc.includes("**Yields** (`Integer`) each spawned enemy id"),
);
check(
  "yard: bare type resolves relative to the namespace and links",
  initDoc.includes("**Returns** ([`Shaker`](file://"),
);

// Locals: hovering a parameter must not fall through to workspace defs.
const strengthLine = lineOf("@strength = intensity");
const strengthChar = MAIN.split("\n")[strengthLine].indexOf("intensity") + 2;
// deno-lint-ignore no-explicit-any
const localHover: any = await request("textDocument/hover", {
  textDocument: { uri: mainUri },
  position: { line: strengthLine, character: strengthChar },
});
const localDoc = localHover?.contents?.value ?? "";
check(
  "hover: parameter resolves locally, not to workspace defs",
  localDoc.includes("parameter of `Fx::Shaker#initialize`") &&
    !localDoc.includes("definitions"),
  localDoc.slice(0, 60),
);
// deno-lint-ignore no-explicit-any
const localDef: any = await request("textDocument/definition", {
  textDocument: { uri: mainUri },
  position: { line: strengthLine, character: strengthChar },
});
check(
  "definition: parameter jumps to the def line, not other files",
  Array.isArray(localDef) && localDef.length === 1 &&
    localDef[0].range.start.line === lineOf("def initialize intensity"),
  `${localDef?.length ?? 0} result(s)`,
);

const perf = diags.find((d) => d.code === "array-manipulation");
check(
  "diagnostics: perf hint — mutation during iteration (guide-linked)",
  !!perf && perf.message.includes("while it's being iterated") &&
    (perf.codeDescription?.href ?? "").includes("troubleshoot-performance"),
  perf ? "links the guide" : "missing",
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

// --- secondary sessions (dormant + monorepo detection) ----------------------

type Mini = {
  // deno-lint-ignore no-explicit-any
  request: (method: string, params: unknown) => Promise<any>;
  notify: (method: string, params: unknown) => Promise<void>;
  close: () => Promise<void>;
};

const miniSession = (cwd: string): Mini => {
  const proc = new Deno.Command(cmd, {
    args,
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const w = proc.stdin.getWriter();
  let id = 1000;
  let buf = new Uint8Array(0);
  // deno-lint-ignore no-explicit-any
  const waiting = new Map<number, (r: any) => void>();

  (async () => {
    for await (const chunk of proc.stdout) {
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf);
      merged.set(chunk, buf.length);
      buf = merged;
      while (true) {
        const text = decoder.decode(buf);
        const headerEnd = text.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const length = Number(text.match(/Content-Length: (\d+)/i)?.[1] ?? 0);
        const bodyStart = encoder.encode(text.slice(0, headerEnd + 4)).length;
        if (buf.length < bodyStart + length) break;
        const body = JSON.parse(
          decoder.decode(buf.slice(bodyStart, bodyStart + length)),
        );
        buf = buf.slice(bodyStart + length);
        if (body.id !== undefined && waiting.has(body.id)) {
          waiting.get(body.id)!(body.result);
          waiting.delete(body.id);
        }
      }
    }
  })();

  const sendMini = async (message: unknown) => {
    const body = encoder.encode(JSON.stringify(message));
    await w.write(encoder.encode(`Content-Length: ${body.length}\r\n\r\n`));
    await w.write(body);
  };

  return {
    request: (method, params) => {
      const rid = id++;
      // deno-lint-ignore no-explicit-any
      const promise = new Promise<any>((resolve, reject) => {
        waiting.set(rid, resolve);
        setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
      });
      sendMini({ jsonrpc: "2.0", id: rid, method, params });
      return promise;
    },
    notify: (method, params) => sendMini({ jsonrpc: "2.0", method, params }),
    close: async () => {
      await sendMini({ jsonrpc: "2.0", method: "exit", params: null });
      proc.kill();
    },
  };
};

// Dormant: a non-DragonRuby workspace gets no capabilities.
const plain = await Deno.makeTempDir({ prefix: "drenv-lsp-plain-" });
await Deno.writeTextFile(join(plain, "app.rb"), "puts 'rails-ish'\n");
const dormantSession = miniSession(plain);
const initDormant = await dormantSession.request("initialize", {
  processId: null,
  rootUri: toFileUrl(plain).href,
  capabilities: {},
});
check(
  "dormant: non-DragonRuby workspace advertises no capabilities",
  initDormant?.serverInfo?.version?.includes("dormant") &&
    !initDormant?.capabilities?.completionProvider,
  initDormant?.serverInfo?.version ?? "no response",
);
await dormantSession.close();
await Deno.remove(plain, { recursive: true }).catch(() => {});

// Monorepo: markers one level below the workspace root (conjuration/demo
// shape) must still activate, and the nested mygame must be indexed.
const mono = await Deno.makeTempDir({ prefix: "drenv-lsp-mono-" });
await ensureDir(join(mono, "lib"));
await Deno.writeTextFile(join(mono, "drenv.toml"), '[package]\nroot = "lib"\n');
await ensureDir(join(mono, "demo", "mygame", "app"));
await Deno.writeTextFile(join(mono, "demo", "dragonruby"), "");
await Deno.writeTextFile(
  join(mono, "demo", "mygame", "app", "helpers.rb"),
  "def nested_helper args\nend\n",
);

// Library source + its vendored twin (a path dep back into this workspace):
// definitions must point at the source only.
await Deno.writeTextFile(
  join(mono, "lib", "thing.rb"),
  "def source_thing args\nend\n",
);
await ensureDir(join(mono, "demo", "mygame", "vendor", "thing"));
await Deno.writeTextFile(
  join(mono, "demo", "mygame", "vendor", "thing", "thing.rb"),
  "def source_thing args\nend\n",
);
await Deno.writeTextFile(
  join(mono, "demo", "mygame", "drenv.lock"),
  'lockfile_version = 1\nmanifest_digest = "x"\n\n' +
    '[[dependencies]]\nname = "thing"\nsource = "path:../.."\n' +
    'require = ["vendor/thing/thing.rb"]\n',
);

const monoMain = join(mono, "demo", "mygame", "app", "main.rb");
const MONO_MAIN =
  "def tick args\n  nested_helper args\n  source_thing args\nend\n";
await Deno.writeTextFile(monoMain, MONO_MAIN);

const monoSession = miniSession(mono);
const initMono = await monoSession.request("initialize", {
  processId: null,
  rootUri: toFileUrl(mono).href,
  capabilities: {},
});
check(
  "monorepo: markers one level down still activate the server",
  !!initMono?.capabilities?.completionProvider,
  initMono?.serverInfo?.version ?? "no response",
);

await monoSession.notify("textDocument/didOpen", {
  textDocument: {
    uri: toFileUrl(monoMain).href,
    languageId: "ruby",
    version: 1,
    text: MONO_MAIN,
  },
});
const monoDef = await monoSession.request("textDocument/definition", {
  textDocument: { uri: toFileUrl(monoMain).href },
  position: { line: 1, character: 4 },
});
check(
  "monorepo: nested mygame is indexed (cross-file definition)",
  Array.isArray(monoDef) && monoDef.length === 1 &&
    monoDef[0].uri.endsWith("helpers.rb"),
  monoDef?.[0]?.uri?.split("/").slice(-2).join("/") ?? "no result",
);

// source_thing exists in lib/ AND vendor/ — the vendored twin must be
// deduped, leaving exactly the source definition.
const twinDef = await monoSession.request("textDocument/definition", {
  textDocument: { uri: toFileUrl(monoMain).href },
  position: { line: 2, character: 4 },
});
check(
  "monorepo: vendored twin deduped — definition points at lib/ source only",
  Array.isArray(twinDef) && twinDef.length === 1 &&
    twinDef[0].uri.includes("/lib/thing.rb"),
  `${twinDef?.length ?? 0} result(s): ` +
    (twinDef ?? []).map((d: { uri: string }) =>
      d.uri.split("/").slice(-3).join("/")
    ).join(" | "),
);
await monoSession.close();
await Deno.remove(mono, { recursive: true }).catch(() => {});
await pump.catch(() => {});
await Deno.remove(tmp, { recursive: true }).catch(() => {});

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILED`);
Deno.exit(failures === 0 ? 0 : 1);
