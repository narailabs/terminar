//! Shell initialization: injects keybindings (word/line navigation) into new PTY sessions
//! by setting ZDOTDIR to a custom directory with init scripts that source the user's
//! original dotfiles first, then add terminar-specific bindings.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tracing::{debug, warn};

const ZSH_ZSHENV: &str = r#"# Terminar shell initialization
# Restore ZDOTDIR so user's .zshenv is sourced, then re-set for our .zshrc
_terminar_zdotdir="$ZDOTDIR"
if [ -n "$TERMINAR_ORIGINAL_ZDOTDIR" ]; then
  ZDOTDIR="$TERMINAR_ORIGINAL_ZDOTDIR"
else
  unset ZDOTDIR
fi
[ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && . "${ZDOTDIR:-$HOME}/.zshenv"
ZDOTDIR="$_terminar_zdotdir"
unset _terminar_zdotdir
"#;

const ZSH_ZSHRC: &str = r#"# Terminar shell initialization
# Restore ZDOTDIR permanently and source user's .zshrc
if [ -n "$TERMINAR_ORIGINAL_ZDOTDIR" ]; then
  ZDOTDIR="$TERMINAR_ORIGINAL_ZDOTDIR"
else
  unset ZDOTDIR
fi
unset TERMINAR_ORIGINAL_ZDOTDIR
[ -f "${ZDOTDIR:-$HOME}/.zshrc" ] && . "${ZDOTDIR:-$HOME}/.zshrc"

# Word/line navigation (works in both emacs and vi modes)
bindkey '\ef' forward-word
bindkey '\eb' backward-word
bindkey '\C-a' beginning-of-line
bindkey '\C-e' end-of-line
"#;

fn shell_init_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join(".terminar")
        .join("shell-init")
        .join("zsh")
}

/// Write zsh init files to ~/.terminar/shell-init/zsh/
fn ensure_zsh_init_files() -> std::io::Result<PathBuf> {
    let dir = shell_init_dir();
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(".zshenv"), ZSH_ZSHENV)?;
    fs::write(dir.join(".zshrc"), ZSH_ZSHRC)?;
    debug!("Zsh init files written to {}", dir.display());
    Ok(dir)
}

/// Prepare environment for a zsh session with word-navigation keybindings.
/// Sets ZDOTDIR to our init directory which sources the user's dotfiles
/// then adds terminar-specific bindings.
pub fn prepare_zsh_env(env: &HashMap<String, String>) -> HashMap<String, String> {
    let mut env = env.clone();

    match ensure_zsh_init_files() {
        Ok(init_dir) => {
            // Preserve user's ZDOTDIR (from env map or process environment)
            if let Some(zdotdir) = env
                .get("ZDOTDIR")
                .cloned()
                .or_else(|| std::env::var("ZDOTDIR").ok())
            {
                env.insert("TERMINAR_ORIGINAL_ZDOTDIR".to_string(), zdotdir);
            }
            env.insert(
                "ZDOTDIR".to_string(),
                init_dir.to_string_lossy().to_string(),
            );
        }
        Err(e) => {
            warn!("Failed to create zsh init files: {e}");
        }
    }

    env
}
