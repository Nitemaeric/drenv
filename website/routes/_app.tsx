import { type PageProps } from "$fresh/server.ts";
export default function App({ Component }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>drenv — DragonRuby Environment Manager</title>
        <meta name="description" content="Install, manage, and switch between multiple DragonRuby versions with a simple CLI. The DragonRuby Environment Manager." />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
