import { copy } from "jsr:@std/fs";

import { versionsPath } from "../constants.ts";

import global from "./global.ts";

export default async function newCommand(name: string) {
  return copy(`${versionsPath}/${await global()}`, name);
}
