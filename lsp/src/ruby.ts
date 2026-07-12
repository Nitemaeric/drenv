import { Language, Parser, type Tree } from "npm:web-tree-sitter@0.25.3";

export type { Node, Tree } from "npm:web-tree-sitter@0.25.3";

export class Ruby {
  #parser: Parser;

  private constructor(parser: Parser) {
    this.#parser = parser;
  }

  /** Loads both wasm blobs from ../vendor as BYTES (deno compile --include
   * compatibility — never Language.load(path)). */
  static async init(): Promise<Ruby> {
    const wasm = (name: string) =>
      Deno.readFile(new URL(`../vendor/${name}`, import.meta.url));
    await Parser.init({ wasmBinary: await wasm("tree-sitter.wasm") });
    const language = await Language.load(await wasm("tree-sitter-ruby.wasm"));
    const parser = new Parser();
    parser.setLanguage(language);
    return new Ruby(parser);
  }

  parse(text: string): Tree {
    return this.#parser.parse(text)!;
  }
}
