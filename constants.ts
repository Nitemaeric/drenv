export const homePath = `${Deno.env.get("HOME")}/.drenv`;
export const versionsPath = `${homePath}/versions`;
export const binPath = `${homePath}/bin`;
export const drenvBinPath = `${binPath}/drenv`;
export const shell = Deno.env.get("SHELL");
