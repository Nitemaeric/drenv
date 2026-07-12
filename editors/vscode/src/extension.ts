import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

function resolveBinary(): string | undefined {
  const which = process.platform === "win32" ? "where" : "which";
  try {
    const found = execFileSync(which, ["drenv"], { encoding: "utf8" })
      .split(/\r?\n/)[0]
      .trim();
    if (found) return found;
  } catch {
    // not on PATH
  }
  return undefined;
}

export function activate(_context: vscode.ExtensionContext): void {
  const command = resolveBinary();
  if (!command) {
    vscode.window.showErrorMessage(
      "drenv: 'drenv' was not found on PATH (is ~/.drenv/bin on your " +
        "PATH?). The language server will not start.",
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
