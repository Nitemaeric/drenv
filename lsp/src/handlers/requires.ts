import { dirname, fromFileUrl, join, relative } from "@std/path";
import type { Loc, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

const REQUIRE = /\b(require|require_relative)\s*\(?\s*(["'])([^"']*)$/;

// DragonRuby resolves `require "app/x.rb"` against the game directory: the
// nearest ancestor of `file` holding `app/main.rb`, else the file's own folder.
const gameRoot = (ctx: Ctx, file: string): string => {
  const files = new Set(
    [...ctx.ws.fileUris()].map((u) => fromFileUrl(u)),
  );
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    if (files.has(join(dir, "app", "main.rb"))) return dir;
  }
  return dirname(file);
};

const withRb = (path: string) => path.endsWith(".rb") ? path : `${path}.rb`;

/** Go-to-definition on the path string of a `require` / `require_relative`:
 * the indexed file it loads. null when the cursor isn't on one. */
export const requireTarget = (
  ctx: Ctx,
  uri: string,
  pos: Pos,
): Loc[] | null => {
  const node = ctx.ws.fileTree(uri)?.rootNode.descendantForPosition({
    row: pos.line,
    column: pos.character,
  });
  const str = node?.type === "string_content" ? node.parent : node;
  const call = str?.type === "string" ? str.parent?.parent : null;
  const method = call?.childForFieldName("method")?.text;
  if (
    !str || call?.type !== "call" || call.childForFieldName("receiver") ||
    (method !== "require" && method !== "require_relative")
  ) {
    return null;
  }

  const path = withRb(str.text.slice(1, -1));
  const file = fromFileUrl(uri);
  const target = method === "require_relative"
    ? join(dirname(file), path)
    : join(gameRoot(ctx, file), path);
  const start = { line: 0, character: 0 };
  const hit = [...ctx.ws.fileUris()].find((u) => fromFileUrl(u) === target);
  return hit ? [{ uri: hit, range: { start, end: start } }] : [];
};

/** Paths of indexed files completing the string of a `require` (relative to
 * the game directory) or `require_relative` (to this file). null outside one. */
export const requireCompletions = (
  ctx: Ctx,
  uri: string,
  pos: Pos,
  prefix: string,
): unknown[] | null => {
  const m = prefix.match(REQUIRE);
  if (!m) return null;
  const file = fromFileUrl(uri);
  const base = m[1] === "require_relative"
    ? dirname(file)
    : gameRoot(ctx, file);
  const typed = m[3];
  const start = pos.character - typed.length;

  const items: unknown[] = [];
  for (const u of ctx.ws.fileUris()) {
    const path = fromFileUrl(u);
    if (path === file || !path.startsWith(base)) continue;
    const rel = relative(base, path).replaceAll("\\", "/");
    if (rel.startsWith("..")) continue;
    items.push({
      label: rel,
      kind: 17, // File
      textEdit: {
        range: { start: { line: pos.line, character: start }, end: pos },
        newText: rel,
      },
    });
    if (items.length >= 500) break;
  }
  return items;
};
