import { type Handler } from "$fresh/server.ts";

// Redirect drenv.org/install.ps1 to the raw GitHub PowerShell installer
export const handler: Handler = {
  GET() {
    const rawUrl =
      "https://raw.githubusercontent.com/Nitemaeric/drenv/main/install.ps1";

    return Response.redirect(rawUrl, 307);
  },
};
