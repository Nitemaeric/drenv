import { ElementHandle, launch } from "@astral/astral";
import { promptSecret } from "@std/cli";
import { existsSync } from "@std/fs";
import ora from "ora";

import register from "./register.ts";
import { homePath } from "../constants.ts";

const buildTargetLookup: Record<string, string> = {
  "x86_64-pc-windows-msvc": "dragonruby-gtk-windows-amd64.zip",
  "x86_64-apple-darwin": "dragonruby-gtk-macos.zip",
  "aarch64-apple-darwin": "dragonruby-gtk-macos.zip",
  "x86_64-unknown-linux-gnu": "dragonruby-gtk-linux-amd64.zip",
  "aarch64-unknown-linux-gnu": "dragonruby-gtk-linux-arm64.zip",
};

const downloadName = buildTargetLookup[Deno.build.target];

export default async function install(tier: string = "standard") {
  if (tier !== "standard") {
    throw new Error("drenv: Only the standard tier is supported at this time");
  }

  const kv = await Deno.openKv(homePath + "/database.db");

  let username: string = (await kv.get(["itch", "username"])).value as string;
  let password: string = (await kv.get(["itch", "password"])).value as string;

  const spinner = ora({ discardStdin: false }).start("Signing into itch.io");

  const browser = await launch();

  const page = await browser.newPage("https://itch.io/login");

  const celestial = page.unsafelyGetCelestialBindings();

  await celestial.Browser.setDownloadBehavior({
    behavior: "allow",
    downloadPath: "./tmp",
  });

  const usernameInput = await page.$("input[name='username']");

  if (usernameInput) {
    if (!username) {
      username = prompt("Enter your username:") || "";
    }

    await usernameInput.type(username);

    if (!password) {
      password = promptSecret("Enter your password:") || "";
    }

    const passwordInput = await page.$("input[name='password']");
    await passwordInput!.type(password);

    const submit = await page.$(".login_form_widget form button");
    await submit!.click();

    await page.waitForNavigation();
  }

  await kv.set(["itch", "username"], username);
  await kv.set(["itch", "password"], password);

  spinner.text = "Downloading the latest version of DragonRuby GTK";

  try {
    await page.goto("https://dragonruby.itch.io/dragonruby-gtk");

    const downloadButton = await page.$(
      ".purchase_banner.above_game_banner a.button",
    );
    await downloadButton!.click();

    await page.waitForNavigation();

    const platformDownloadButtons: Record<string, ElementHandle> = await Array
      .from<ElementHandle>(await page.$$(".upload")).reduce(
        async (object, row) => ({
          ...(await object),
          [await (await row.$(".name"))!.innerText()]: await row.$(
            "a.button.download_btn",
          ),
        }),
        Promise.resolve({}),
      );

    await platformDownloadButtons[downloadName]!.click();

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        reject(new Error("Download timed out"));
      }, 10000);

      const intervalId = setInterval(() => {
        if (existsSync(`./tmp/${downloadName}`)) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          resolve(true);
        }
      }, 200);
    });

    spinner.text = "Installing the latest version of DragonRuby GTK";

    const message = await register(`./tmp/${downloadName}`);

    spinner.succeed(message);
  } catch (err) {
    const error = err as Error;

    spinner.fail(error.message);
  } finally {
    spinner.stop();

    await browser.close();
  }
}
