import { copy } from "jsr:@std/fs";

import { readVersion } from "../utils/read-version.ts";

import global from "./global.ts";

export default async function newCommand(name: string | undefined = undefined) {
  return copy(
    `${Deno.env.get("HOME")}/.drenv/versions/${await global()}`,
    name,
  );
}
