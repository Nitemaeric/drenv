import { type Handler } from "$fresh/server.ts";

// Redirect drenv.org/install.sh to the raw GitHub script (single source of truth at repo root)
export const handler: Handler = {
  GET() {
    const rawUrl =
      "https://raw.githubusercontent.com/Nitemaeric/drenv/main/install.sh";

    // Use 307 Temporary Redirect so curl -fsSL follows it reliably
    return Response.redirect(rawUrl, 307);
  },
};
