use zed_extension_api::{self as zed, Result};

struct DrenvExtension;

impl zed::Extension for DrenvExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // Prefer the spike binary while it exists; fall back to drenv itself
        // once `drenv lsp` ships in the main binary.
        let command = worktree
            .which("drenv-lsp-spike")
            .or_else(|| worktree.which("drenv"))
            .ok_or("drenv not found on PATH (is ~/.drenv/bin on your PATH?)")?;

        Ok(zed::Command {
            command,
            args: vec!["lsp".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(DrenvExtension);
