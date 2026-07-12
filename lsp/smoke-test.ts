// Minimal LSP round-trip against a compiled binary: proves the server starts
// (tree-sitter wasm embedded and loadable) and answers initialize. Runs in a
// bare temp dir, so it needs no DragonRuby install (dormant mode still boots
// the parser). Usage: deno run -A lsp/smoke-test.ts <command> [args...]
const [cmd, ...args] = Deno.args;
if (!cmd) {
  console.error("usage: smoke-test.ts <server command...>");
  Deno.exit(2);
}

// The child runs in a temp cwd, so a relative binary path must be resolved
// against the invoking directory first.
const command = cmd.includes("/") || cmd.includes("\\")
  ? await Deno.realPath(cmd)
  : cmd;

const cwd = await Deno.makeTempDir({ prefix: "drenv-lsp-smoke-" });
const proc = new Deno.Command(command, {
  args,
  cwd,
  stdin: "piped",
  stdout: "piped",
  stderr: "inherit",
}).spawn();

const writer = proc.stdin.getWriter();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const send = async (message: unknown) => {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const frame = new Uint8Array(header.length + body.length);
  frame.set(header);
  frame.set(body, header.length);
  await writer.write(frame);
};

const timeout = setTimeout(() => {
  console.error("smoke: no initialize response within 20s");
  proc.kill();
  Deno.exit(1);
}, 20_000);

await send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { processId: null, rootUri: null, capabilities: {} },
});

let buffer = "";
for await (const chunk of proc.stdout) {
  buffer += decoder.decode(chunk, { stream: true });
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) continue;
  const length = Number(buffer.match(/Content-Length: (\d+)/i)?.[1] ?? 0);
  const body = buffer.slice(headerEnd + 4);
  if (encoder.encode(body).length < length) continue;

  const response = JSON.parse(body.slice(0, length));
  if (response.id === 1 && "result" in response) {
    clearTimeout(timeout);
    console.log("smoke: initialize answered — server boots");
    await send({ jsonrpc: "2.0", method: "exit", params: null });
    proc.kill();
    Deno.exit(0);
  }
}

console.error("smoke: server exited without answering initialize");
Deno.exit(1);
