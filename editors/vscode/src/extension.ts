import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

// Prefer the spike binary while it exists; fall back to drenv itself
// once `drenv lsp` ships in the main binary. Mirrors editors/zed.
const BINARY_CANDIDATES = ["drenv-lsp-spike", "drenv"];

function resolveBinary(): string | undefined {
  const which = process.platform === "win32" ? "where" : "which";
  for (const candidate of BINARY_CANDIDATES) {
    try {
      const found = execFileSync(which, [candidate], { encoding: "utf8" })
        .split(/\r?\n/)[0]
        .trim();
      if (found) return found;
    } catch {
      // not on PATH; try the next candidate
    }
  }
  return undefined;
}

export function activate(_context: vscode.ExtensionContext): void {
  const command = resolveBinary();
  if (!command) {
    vscode.window.showErrorMessage(
      "drenv: neither 'drenv-lsp-spike' nor 'drenv' was found on PATH " +
        "(is ~/.drenv/bin on your PATH?). The language server will not start.",
    );
    return;
  }

  const serverOptions: ServerOptions = {
    run: { command, args: ["lsp"], transport: TransportKind.stdio },
    debug: { command, args: ["lsp"], transport: TransportKind.stdio },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "ruby" },
      { scheme: "file", language: "toml" },
    ],
  };

  client = new LanguageClient(
    "drenv",
    "drenv",
    serverOptions,
    clientOptions,
  );

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
