import { type PageProps } from "$fresh/server.ts";
export default function App({ Component }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>drenv — DragonRuby Environment Manager</title>
        <meta
          name="description"
          content="Install DragonRuby (standard, indie, and pro), manage versions, scaffold projects, and vendor your game's dependencies — one small, fast CLI. The DragonRuby Environment Manager."
        />
        <link rel="icon" href="/favicon.ico?v=2" sizes="any" />
        <link rel="icon" href="/icon.png?v=2" type="image/png" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
