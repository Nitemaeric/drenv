const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");

export const homePath = `${home}/.drenv`;
export const versionsPath = `${homePath}/versions`;
export const binPath = `${homePath}/bin`;
export const drenvBinPath = `${binPath}/drenv${
  Deno.build.os === "windows" ? ".exe" : ""
}`;
export const shell = Deno.env.get("SHELL");
