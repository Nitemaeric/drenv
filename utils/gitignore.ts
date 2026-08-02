// Both templates follow the engine's own guidance in
// docs/guides/starting-a-new-project.md: a public repo must not redistribute
// the engine; a private/commercial repo commits everything — engine, docs/,
// samples/, builds/ — so the game keeps working with its exact engine version.
export const PUBLIC_GITIGNORE = `.DS_Store

# DragonRuby binaries (re-added by drenv new / drenv use)
dragonruby
dragonruby.exe
dragonruby-publish
dragonruby-publish.exe
dragonruby-bind
dragonruby-bind.exe
dragonruby-firestarter
dragonruby-httpd

# Pro iOS toolchain and C-extension headers
/dragonruby-ios.app/
/dragonruby-ios-simulator.app/
/include/

# Build and runtime artifacts
/tmp/
/builds/
/logs/
/.dragonruby/

# Bundled DragonRuby docs and samples
/docs/
/samples/

# Engine-distribution files (re-added by drenv new / drenv use)
/ctags-emacs
/ctags-vim
/CHANGELOG-CURR.txt
/CHANGELOG-PREV.txt
/README.txt
/VERSION.txt
/eula.txt
/open-source-licenses.txt
/console-logo.png
/dragonruby-controller.png
/dragonruby.png
/font.ttf
/tiny.ttf
`;

export const PRIVATE_GITIGNORE = `.DS_Store

# Runtime artifacts. Everything else — engine binaries, docs/, samples/,
# builds/ — is committed, per DragonRuby's guidance for private repos.
/tmp/
/logs/
`;

/** Asks whether the repository will be public and returns the matching
 * template. Non-interactive runs (prompt() is null off a TTY) take the
 * private default. */
export const askTemplate = (): string => {
  const answer = prompt("drenv: Will this be a public repository? y/N (N)");
  const isPublic = (answer ?? "").trim().toLowerCase().startsWith("y");
  return isPublic ? PUBLIC_GITIGNORE : PRIVATE_GITIGNORE;
};
