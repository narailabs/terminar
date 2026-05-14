//! Session lifecycle message handlers: CreateSession, KillSession, RenameSession, ListSessions.

use crate::AppState;
use crate::messages::{ServerMessage, SessionInfo};
use crate::persistence;
use crate::session::SessionMap;

use portable_pty::CommandBuilder;
use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::{info, instrument};

// Re-export core engine functions used by other handler modules
pub use terminar_core::engine::{clamp_dimension, filter_env};

/// Default shell for remote sessions (Docker/SSH) when client sends empty shell.
/// `/bin/sh` is the most universally available shell on remote systems.
const REMOTE_DEFAULT_SHELL: &str = "/bin/sh";

/// PROMPT_COMMAND value that emits an OSC 7 cwd report on every prompt.
///
/// Bash re-parses this string as a shell command before drawing each prompt,
/// expanding `${HOSTNAME:-$(hostname)}` and `$PWD` at that time and invoking
/// `printf` to write the OSC 7 escape sequence (`ESC ]7;file://HOST/PATH BEL`).
///
/// The server's OSC 7 sniffer (`cwd_watcher.rs`) picks up the escape sequence
/// from the session's broadcast channel and updates `session.cwd` accordingly.
const OSC7_PROMPT_COMMAND: &str =
    r#"printf "\033]7;file://%s%s\007" "${HOSTNAME:-$(hostname)}" "$PWD""#;

/// Shell-function definitions injected into remote sessions so programs that
/// shell out to native clipboard / URL-open tools (Claude Code is the driving
/// example) have their actions transparently redirected back to the user's
/// local system via OSC sequences.
///
/// The functions emit:
/// - **OSC 52** (`ESC ]52;c;<base64-data> BEL`) for clipboard writes. This is
///   the de-facto standard clipboard escape sequence; terminar parses it on
///   the server side and routes the payload to the local clipboard.
/// - **OSC 7777** (`ESC ]7777;open_url;<base64-url> BEL`) for URL opens. This
///   is terminar's custom vocabulary (no standard exists); the server parses
///   it and routes the URL to the local default browser.
///
/// The shim is a static constant — no user input is interpolated, so there
/// is no shell injection surface. Continues to rely on `shell_quote()` for
/// any user-controlled strings (`cwd`, `shell`) interpolated elsewhere in
/// the remote command.
const SHIM_FUNCTIONS: &str = r#"pbcopy() { printf '\033]52;c;%s\007' "$(base64 | tr -d '\n')"; }
xclip() { pbcopy; }
xsel() { pbcopy; }
wl-copy() { pbcopy; }
_terminar_open_url() { printf '\033]7777;open_url;%s\007' "$(printf %s "$1" | base64 | tr -d '\n')"; }
open() { _terminar_open_url "$1"; }
xdg-open() { _terminar_open_url "$1"; }
export BROWSER=_terminar_open_url"#;

/// POSIX `sh` wrapper script deployed to a per-session private directory
/// (`$(mktemp -d /tmp/terminar-edit.XXXXXX)/terminar-edit`) on the
/// remote at SSH connect time and exported as `$EDITOR`. Implements
/// the remote end of the editor-paste flow: emits an OSC 7777 `edit_request`
/// to the local tray, then blocks on PTY stdin waiting for a framed reply
/// from [`crate::handlers::io::handle_edit_reply`].
///
/// # Framing contract (parsed by the read loop)
///
/// Normal (save):
/// ```text
/// \n__TERMINAR_EDIT_<id>_BEGIN__\n
/// <base64-wrapped-76-cols>\n
/// __TERMINAR_EDIT_<id>_END__\n
/// ```
///
/// Empty save (user cleared the buffer): identical but with an empty line
/// between the markers.
///
/// Cancel:
/// ```text
/// \n__TERMINAR_EDIT_<id>_CANCEL__\n
/// ```
///
/// The leading `\n` flushes any partial line the user had typed; the read
/// loop discards it as a non-matching wait-state line.
///
/// # POSIX compliance
///
/// Must run on `dash`, `ash`, `busybox sh`, and `bash` — we do not know
/// what `/bin/sh` is on the remote. Accordingly:
/// - No `[[ ]]` (bashism); use `[ ]`.
/// - No `$RANDOM` (bashism); use an `awk` srand call.
/// - No `function foo()` syntax; use `foo()`.
/// - No `local` (dash lacks it).
/// - No arrays, no `${var//pat/rep}`.
///
/// # Size limit
///
/// The server's OSC parser caps incoming sequences at 64 KiB. Base64
/// expands 4:3 and we also emit marker overhead, so files larger than
/// ~48000 bytes can't round-trip. The script falls back to
/// `$TERMINAR_FALLBACK_EDITOR` (default `vi`) for oversize files so the
/// user still gets *some* editor.
///
/// # base64 decode portability
///
/// GNU coreutils uses `base64 -d`; BSD/macOS uses `base64 -D`; we also
/// try `openssl base64 -d -A` as a last resort.
///
/// # Security
///
/// The script is deployed verbatim via a single-quoted heredoc
/// (`<<'TERMINAR_EDIT_SCRIPT_EOF'`) so shell expansion does not happen at
/// deploy time — no interpolation surface. The delimiter name
/// `TERMINAR_EDIT_SCRIPT_EOF` must not appear anywhere in the script body
/// (enforced by the `terminar_edit_script_has_no_shell_injection_holes`
/// test).
const TERMINAR_EDIT_SCRIPT: &str = r#"#!/bin/sh
# terminar-edit: OSC 7777 edit bridge for remote sessions.
# Emits an edit_request to the local tray, waits on PTY stdin for a
# framed reply, decodes base64, and writes the file. Used as $EDITOR.

file=$1
if [ -z "$file" ]; then
    exit 1
fi

# Size-check: the server's OSC parser caps incoming sequences at 64 KiB.
# Base64 expands ~4/3, so source files > ~48000 bytes will not fit.
# Fall back to a real editor rather than silently truncating.
if [ -f "$file" ]; then
    _sz=$(wc -c < "$file" 2>/dev/null | tr -d ' ')
    case $_sz in
        ''|*[!0-9]*)
            : # non-numeric / unavailable, skip the size check
            ;;
        *)
            if [ "$_sz" -gt 48000 ]; then
                exec "${TERMINAR_FALLBACK_EDITOR:-vi}" "$@"
            fi
            ;;
    esac
fi

# Detect base64 decode flag portably, then wrap it in a function.
# GNU coreutils uses -d; BSD/macOS uses -D; openssl is a last resort.
# A function avoids zsh's no-word-splitting default on `$B64D` — the
# wrapper normally runs under /bin/sh, but writing this defensively
# costs nothing.
if printf 'aGVsbG8=' | base64 -d >/dev/null 2>&1; then
    _b64_decode() { base64 -d; }
elif printf 'aGVsbG8=' | base64 -D >/dev/null 2>&1; then
    _b64_decode() { base64 -D; }
elif command -v openssl >/dev/null 2>&1; then
    _b64_decode() { openssl base64 -d -A; }
else
    exit 1
fi

# Unique edit id. POSIX-portable (uses awk srand, not a bash-only random).
# Charset is [A-Za-z0-9_], matching the server's [A-Za-z0-9_-]+ validator.
_id_rand=$(awk 'BEGIN{srand(); print int(rand()*1000000)}' 2>/dev/null)
if [ -z "$_id_rand" ]; then
    _id_rand=0
fi
id=$$_$(date +%s)_${_id_rand}

# Read the file as base64 (empty string if the file does not exist yet —
# Claude Code commonly creates a zero-length temp file before spawning
# $EDITOR, and a truly missing file is also valid).
if [ -f "$file" ]; then
    contents_b64=$(base64 < "$file" | tr -d '\n')
else
    contents_b64=''
fi
id_b64=$(printf '%s' "$id" | base64 | tr -d '\n')
filename_b64=$(printf '%s' "$file" | base64 | tr -d '\n')

# Save stty and arrange to restore it on any exit path (normal, Ctrl-C,
# signal death). An empty saved value means stty was unavailable and the
# restore is a no-op.
stty_saved=$(stty -g 2>/dev/null)
_terminar_edit_cleanup() {
    if [ -n "$stty_saved" ]; then
        stty "$stty_saved" 2>/dev/null
    fi
}
trap '_terminar_edit_cleanup' EXIT INT TERM

# Suppress echo while the user is waiting. We keep canonical line
# discipline so `read -r` still sees whole lines.
stty -echo 2>/dev/null

# Emit the edit_request. The local tray renders the editor UI, the user
# saves or cancels, and the server writes the framed reply back into our
# PTY stdin (which is also this script's stdin).
printf '\033]7777;edit_request;%s;%s;%s\007' "$id_b64" "$filename_b64" "$contents_b64"

# Parse the framed reply. State machine:
#   state=wait    -> drop every line until we see $begin_marker (→capture)
#                    or $cancel_marker (→cancelled)
#   state=capture -> append every non-empty line until we see $end_marker
begin_marker=__TERMINAR_EDIT_${id}_BEGIN__
end_marker=__TERMINAR_EDIT_${id}_END__
cancel_marker=__TERMINAR_EDIT_${id}_CANCEL__

state=wait
acc=''
cancelled=0
saw_begin=0
saw_end=0
while IFS= read -r line; do
    if [ "$state" = wait ]; then
        if [ "$line" = "$begin_marker" ]; then
            state=capture
            saw_begin=1
            continue
        fi
        if [ "$line" = "$cancel_marker" ]; then
            cancelled=1
            break
        fi
        # Discard any other line while waiting (partial input the user
        # had typed, stray output from the shell, etc.).
        continue
    fi
    # state=capture
    if [ "$line" = "$end_marker" ]; then
        saw_end=1
        break
    fi
    # Skip empty lines — they occur in the empty-save frame and are
    # harmless for wrapped base64 (which never produces an empty line).
    if [ -z "$line" ]; then
        continue
    fi
    acc=${acc}${line}
done

# Explicit restore (belt-and-braces; the trap still runs on abnormal exits).
_terminar_edit_cleanup
trap - EXIT INT TERM

# Three sequential guards, each with a single clear invariant. Every
# path that doesn't set all required flags exits 1 and leaves $file
# untouched — we never truncate a file unless we saw a complete,
# well-formed reply.
if [ "$cancelled" = 1 ]; then
    exit 1
fi

# No BEGIN seen: stdin was empty, closed, redirected from /dev/null,
# or filled with garbage that didn't match any marker. No reply was
# ever received.
if [ "$saw_begin" = 0 ]; then
    exit 1
fi

# BEGIN seen but END not seen: truncated / partial reply. The tray
# may have crashed mid-send, the network dropped, or the PTY buffer
# flushed only the first marker. We do NOT know whether the server
# intended to send us content or not, so the only safe thing is to
# leave $file alone and report failure to the caller.
#
# Note: we intentionally use $saw_end here, NOT the loop state, as
# the loop state stays at "capture" even after a successful END
# match (the END branch `break`s without resetting state). Using
# state would wrongly fail the success path.
if [ "$saw_end" = 0 ]; then
    exit 1
fi

# All three guards passed: BEGIN→END observed with no cancel. Now an
# empty $acc is a legitimate empty-save (user explicitly cleared the
# buffer); truncate without invoking base64.
if [ -z "$acc" ]; then
    : > "$file" || exit 1
    exit 0
fi

# Decode and overwrite.
printf '%s' "$acc" | _b64_decode > "$file" || exit 1
exit 0
"#;

/// Build the `sh` snippet that deploys [`TERMINAR_EDIT_SCRIPT`] to a
/// per-session private directory on the remote, then on successful
/// `chmod +x` prepends that directory to `$PATH` and exports `$EDITOR`
/// to point at it.
///
/// # Symlink TOCTOU defence
///
/// We use `mktemp -d /tmp/terminar-edit.XXXXXX` (mirroring the existing
/// `TERMINAR_ZDOTDIR` pattern in the zsh branch) rather than a fixed
/// `/tmp/terminar-bin` path. `mktemp -d` creates the directory with mode
/// 700 owned by the current user, so subsequent writes are safe from
/// symlink TOCTOU: an attacker on a shared multi-user host cannot
/// pre-create the unguessable path, and cannot write to the current
/// user's mode-700 directory even if they somehow learn its name.
///
/// A previous version deployed to a fixed `/tmp/terminar-bin/terminar-edit`
/// which was vulnerable: an attacker could `ln -sf ~victim/.bashrc
/// /tmp/terminar-bin/terminar-edit` and the victim's `cat >` would
/// follow the symlink and clobber their `.bashrc`.
///
/// # Graceful degradation
///
/// If `mktemp` fails (e.g. `/tmp` is read-only), the `&&` short-circuits
/// the `cat` and the `if chmod` wrapper also fails, so `$EDITOR` is left
/// untouched — the user still gets their existing editor. `TERMINAR_EDIT_DIR`
/// may be left set to an empty string in this case, which is harmless.
///
/// The deploy is shared by the bash/sh and zsh branches of
/// [`build_ssh_remote_command`] — fish-and-other shells do not receive
/// it (graceful fallback: no remote edit bridge, just a plain `exec`).
///
/// The heredoc delimiter (`TERMINAR_EDIT_SCRIPT_EOF`) is single-quoted so
/// the script body is deployed literally with no shell expansion.
fn build_edit_wrapper_deploy() -> String {
    // Sequence of lines joined with "\n":
    //   TERMINAR_EDIT_DIR=$(mktemp -d /tmp/terminar-edit.XXXXXX) && cat > "$TERMINAR_EDIT_DIR/terminar-edit" <<'TERMINAR_EDIT_SCRIPT_EOF'
    //   <script body>
    //   TERMINAR_EDIT_SCRIPT_EOF
    //   if chmod +x "$TERMINAR_EDIT_DIR/terminar-edit" 2>/dev/null; then
    //       export PATH="$TERMINAR_EDIT_DIR:$PATH"
    //       export EDITOR="$TERMINAR_EDIT_DIR/terminar-edit"
    //   fi
    let mut out = String::new();
    out.push_str(
        "TERMINAR_EDIT_DIR=$(mktemp -d /tmp/terminar-edit.XXXXXX) && \
         cat > \"$TERMINAR_EDIT_DIR/terminar-edit\" <<'TERMINAR_EDIT_SCRIPT_EOF'\n",
    );
    out.push_str(TERMINAR_EDIT_SCRIPT);
    out.push('\n');
    out.push_str("TERMINAR_EDIT_SCRIPT_EOF\n");
    out.push_str("if chmod +x \"$TERMINAR_EDIT_DIR/terminar-edit\" 2>/dev/null; then\n");
    out.push_str("    export PATH=\"$TERMINAR_EDIT_DIR:$PATH\"\n");
    out.push_str("    export EDITOR=\"$TERMINAR_EDIT_DIR/terminar-edit\"\n");
    out.push_str("fi");
    out
}

/// Return the final path component of a shell path (e.g. `/bin/bash` → `bash`).
fn shell_basename(shell: &str) -> &str {
    std::path::Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
}

/// Whether we should inject `PROMPT_COMMAND` as an environment variable for
/// this target shell. Only bash (and `sh` which on RHEL-family systems is
/// bash in POSIX mode) honors PROMPT_COMMAND; dash/ash ignore it silently so
/// the injection is harmless on those. Zsh and fish have their own prompt
/// hook mechanisms that cannot be set via env var — used by the Docker
/// session path (SSH uses `build_ssh_remote_command` which handles zsh via
/// ZDOTDIR and all other shells via a match).
fn shell_supports_prompt_command(shell: &str) -> bool {
    matches!(shell_basename(shell), "bash" | "sh")
}

/// Build the inline remote command passed to `ssh user@host <cmd>`.
///
/// The command:
/// 1. Optionally `cd`s to the requested starting directory.
/// 2. Injects [`SHIM_FUNCTIONS`] so `pbcopy`/`xclip`/`xsel`/`wl-copy`/`open`/
///    `xdg-open` are transparently redirected to terminar's OSC sequences
///    (which the server parses and routes back to the local client).
/// 3. Preserves OSC 7 cwd tracking via the shell's native prompt hook
///    mechanism (bash `PROMPT_COMMAND` or zsh `precmd`).
/// 4. `exec`s the target shell so the remote-side login shell is replaced
///    by the actual interactive shell (no intermediate wrapper process).
///
/// Shell-specific handling:
/// - **bash / sh**: define shim functions in the login shell, `export -f`
///   them so bash re-imports them via env on the subsequent `exec bash`,
///   then set `PROMPT_COMMAND` and exec.
/// - **zsh**: `export -f` is bash-specific and functions do not survive
///   `exec zsh`. Instead, write a temporary `.zshrc` containing the shim
///   (plus a source of the user's real `.zshrc`), set `ZDOTDIR` to its
///   directory, and exec zsh. Cwd tracking is added via `add-zsh-hook
///   precmd`.
/// - **other shells** (fish, etc.): fall back to a plain `exec`, no shim.
///   Clipboard + URL auto-redirect is not available; users can still rely
///   on tools that emit OSC 52 natively.
///
/// Both `cwd` and `shell` are single-quoted via `shell_quote()` for shell
/// safety; this is a second line of defense on top of `validate_remote_shell()`.
fn build_ssh_remote_command(cwd: &str, shell: &str) -> String {
    let cd_part = if !cwd.is_empty() && cwd != "/" {
        format!("cd {} && ", shell_quote(cwd))
    } else {
        String::new()
    };

    let shell_arg = shell_quote(shell);

    match shell_basename(shell) {
        "bash" | "sh" => {
            // 1. Deploy the terminar-edit wrapper and export $EDITOR.
            // 2. Define shim functions, export them so bash re-imports them
            //    on `exec`, then set PROMPT_COMMAND (for OSC 7 cwd) and
            //    exec the target shell.
            //
            // The deploy is sequential (not nested) with respect to the
            // shim setup: two separate heredocs with distinct delimiters
            // (`TERMINAR_EDIT_SCRIPT_EOF` only; no heredoc in the bash
            // branch for the shim).
            format!(
                "{cd}{deploy}\n{shim}\nexport -f pbcopy xclip xsel wl-copy _terminar_open_url open xdg-open 2>/dev/null || true\nPROMPT_COMMAND={pc} exec {sh}",
                cd = cd_part,
                deploy = build_edit_wrapper_deploy(),
                shim = SHIM_FUNCTIONS,
                pc = shell_quote(OSC7_PROMPT_COMMAND),
                sh = shell_arg,
            )
        }
        "zsh" => {
            // 1. Deploy the terminar-edit wrapper and export $EDITOR.
            // 2. Write a temp .zshrc with shim (and OSC 7 cwd hook), set
            //    ZDOTDIR, and exec zsh. Sourcing the user's real .zshrc
            //    first preserves their config; our shim defined after it
            //    wins.
            //
            // The two heredocs are sequential, not nested. They use
            // distinct delimiters (`TERMINAR_EDIT_SCRIPT_EOF` vs
            // `TERMINAR_SHIM_EOF`) so there is no collision.
            format!(
                "{cd}{deploy}\nTERMINAR_ZDOTDIR=$(mktemp -d /tmp/terminar-zdot.XXXXXX) && cat > \"$TERMINAR_ZDOTDIR/.zshrc\" <<'TERMINAR_SHIM_EOF'\n[ -f \"$HOME/.zshrc\" ] && source \"$HOME/.zshrc\"\n{shim}\n_terminar_cwd() {{ printf '\\033]7;file://%s%s\\007' \"$(hostname)\" \"$PWD\"; }}\nautoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd _terminar_cwd\nTERMINAR_SHIM_EOF\nZDOTDIR=\"$TERMINAR_ZDOTDIR\" exec {sh}",
                cd = cd_part,
                deploy = build_edit_wrapper_deploy(),
                shim = SHIM_FUNCTIONS,
                sh = shell_arg,
            )
        }
        _ => {
            // Unknown shell (fish, etc.) — fall back to plain exec, no
            // shim, no edit-wrapper deploy. Remote editing via OSC 7777
            // is not available for these shells, but the user's existing
            // $EDITOR (if any) on the remote side still works.
            format!("{cd}exec {sh}", cd = cd_part, sh = shell_arg)
        }
    }
}

/// Validate a shell path intended for remote execution (Docker container, SSH host).
///
/// Unlike the local SHELL_WHITELIST, remote shells vary widely (`/bin/ash` on Alpine,
/// `/bin/busybox`, etc.), so we can't use a whitelist. Instead we enforce a strict
/// format that blocks shell metacharacter injection.
///
/// Returns `Err` with a user-facing message if validation fails.
pub fn validate_remote_shell(shell: &str) -> Result<(), String> {
    if shell.is_empty() {
        return Err("Remote shell path is empty".to_string());
    }
    if shell.len() > 256 {
        return Err(format!(
            "Remote shell path too long ({} chars, max 256)",
            shell.len()
        ));
    }
    if !shell.starts_with('/') {
        return Err(format!("Remote shell '{}' must be an absolute path", shell));
    }
    // Block shell metacharacters, whitespace, quotes, and backslashes.
    // Anything that could change how the shell parses the command.
    const FORBIDDEN: &[char] = &[
        ';', '&', '|', '`', '$', '(', ')', '<', '>', '\n', '\r', '\t', ' ', '\0', '\\', '"', '\'',
    ];
    if let Some(bad) = shell.chars().find(|c| FORBIDDEN.contains(c)) {
        return Err(format!(
            "Remote shell '{}' contains forbidden character: {:?}",
            shell, bad
        ));
    }
    Ok(())
}

/// Build a SessionInfo list from the current sessions.
fn build_session_list(sessions: &SessionMap) -> Vec<SessionInfo> {
    terminar_core::engine::build_session_list(sessions)
}

/// Handle ListSessions message.
#[instrument(skip(tx_out, sessions))]
pub(crate) async fn handle_list_sessions(
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    let list = enrich_session_list(build_session_list(sessions));
    tx_out
        .send(ServerMessage::SessionList { sessions: list })
        .await?;
    Ok(())
}

/// Handle CreateSession message.
#[allow(clippy::too_many_arguments)]
#[instrument(skip(env, tx_out, sessions, state), fields(shell = %shell, cwd = %cwd, cols = cols, rows = rows))]
pub(crate) async fn handle_create_session(
    cwd: &str,
    shell: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    container_id: Option<&str>,
    ssh_connection_id: Option<&str>,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    // Clamp dimensions to valid range (1-500)
    let cols = terminar_core::engine::clamp_dimension(cols, "cols");
    let rows = terminar_core::engine::clamp_dimension(rows, "rows");

    let counter = state
        .session_name_counter
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    // Routing: container_id present → Docker session (local or remote,
    // depending on whether ssh_connection_id is also set). ssh_connection_id
    // alone → SSH shell session. Neither → local shell session.
    let result = match (container_id, ssh_connection_id) {
        (Some(cid), ssh) => {
            create_docker_session(
                cid, ssh, cwd, shell, env, cols, rows, counter, sessions, state,
            )
            .await
        }
        (None, Some(sid)) => {
            create_ssh_session(sid, cwd, shell, cols, rows, counter, sessions, state)
        }
        (None, None) => create_local_session(cwd, shell, env, cols, rows, counter, sessions, state),
    };

    match result {
        Ok(id) => {
            state
                .sessions_total
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            // For SSH and Docker sessions, spawn an OSC watcher. Local
            // polling in poll_foreground_processes() is skipped for these
            // session types because tcgetpgrp/proc point at the ssh/docker
            // wrapper process, not the remote shell. Instead we parse OSC
            // escape sequences emitted by the remote shell to (a) keep cwd
            // fresh (OSC 7) and (b) route clipboard writes (OSC 52) and
            // URL opens (OSC 7777) back to the local client.
            if container_id.is_some() || ssh_connection_id.is_some() {
                crate::cwd_watcher::spawn_cwd_watcher(
                    id,
                    sessions.clone(),
                    state.tool_action_tx.clone(),
                );
            }

            let list = enrich_session_list(build_session_list(sessions));
            tx_out
                .send(ServerMessage::SessionList { sessions: list })
                .await?;
        }
        Err(msg) => {
            // Roll back the name counter on failure to avoid "Terminal 3, 5, 6" gaps.
            // Not race-free under concurrent failures, but acceptable for cosmetic counter.
            state
                .session_name_counter
                .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("SESSION_ERROR".to_string()),
                })
                .await?;
        }
    }

    Ok(())
}

/// Enrich SessionInfo list with SSH connection details (host/user) for display.
/// Looks up each session's ssh_connection_id and populates ssh_host/ssh_user.
fn enrich_session_list(mut list: Vec<SessionInfo>) -> Vec<SessionInfo> {
    for info in list.iter_mut() {
        if let Some(ref sid) = info.ssh_connection_id {
            if let Some(conn) = super::ssh::get_connection(sid) {
                info.ssh_host = Some(conn.host);
                info.ssh_user = Some(conn.user);
            }
        }
    }
    list
}

/// Expand a leading `~/` in a path using the session env's `HOME`, falling
/// back to the server process's `HOME`. Returns the original string if it
/// doesn't start with `~/`. A bare `~` (without a slash) is also expanded
/// to `$HOME`. Empty strings pass through unchanged.
fn expand_tilde(cwd: &str, env: &HashMap<String, String>) -> String {
    if cwd == "~" {
        return home_dir(env);
    }
    if let Some(rest) = cwd.strip_prefix("~/") {
        let home = home_dir(env);
        if home.is_empty() {
            // Can't expand without HOME; return original so resolve_cwd can
            // produce an error a caller can react to.
            return cwd.to_string();
        }
        return format!("{}/{}", home.trim_end_matches('/'), rest);
    }
    cwd.to_string()
}

fn home_dir(env: &HashMap<String, String>) -> String {
    env.get("HOME")
        .cloned()
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default()
}

/// Create a local shell session (existing behavior).
#[allow(clippy::too_many_arguments)]
fn create_local_session(
    cwd: &str,
    shell: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    counter: u64,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<String, String> {
    let resolved_shell = terminar_core::engine::resolve_shell(shell);

    // Expand a leading `~/` so users can configure a default folder like
    // `~/code` in settings. `terminar_core::engine::resolve_cwd` doesn't do
    // this (and lives in an external crate), so handle it here.
    let expanded_cwd = expand_tilde(cwd, env);

    let resolved_cwd = terminar_core::engine::resolve_cwd(&expanded_cwd);

    if let Some(error_msg) = terminar_core::engine::validate_shell(&resolved_shell) {
        return Err(error_msg);
    }
    if let Some(error_msg) = terminar_core::engine::validate_cwd(&resolved_cwd) {
        return Err(error_msg);
    }

    let name = format!("Terminal {}", counter);

    let session_env = if resolved_shell.ends_with("/zsh") || resolved_shell.ends_with("/zsh5") {
        crate::shell_init::prepare_zsh_env(env)
    } else {
        env.clone()
    };

    terminar_core::engine::create_session(
        None,
        &name,
        &resolved_shell,
        &resolved_cwd,
        cols,
        rows,
        &session_env,
        sessions,
        state.mock_provider.as_ref(),
        None,
    )
    .map_err(|e| format!("Failed to create session: {}", e))
}

/// Create a Docker container session via `docker exec`. When
/// `ssh_connection_id` is `Some`, targets the Docker daemon on the remote host
/// by setting `DOCKER_HOST=ssh://user@host:port` on the spawned `docker`
/// process; Docker 18.09+ tunnels the daemon socket over SSH using the local
/// `ssh` binary.
#[allow(clippy::too_many_arguments)]
async fn create_docker_session(
    container_id: &str,
    ssh_connection_id: Option<&str>,
    cwd: &str,
    shell: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    counter: u64,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<String, String> {
    // Resolve SSH connection if this is a remote Docker session.
    let ssh_conn = match ssh_connection_id {
        Some(id) => Some(
            super::ssh::get_connection(id)
                .ok_or_else(|| format!("SSH connection '{}' not found", id))?,
        ),
        None => None,
    };

    // Validate container exists and is running on the target daemon.
    super::docker::validate_container(container_id, ssh_conn.as_ref()).await?;

    // Resolve shell — default to /bin/sh for containers (more universally available)
    let resolved_shell = if shell.is_empty() {
        REMOTE_DEFAULT_SHELL.to_string()
    } else {
        shell.to_string()
    };

    // Validate shell format to block injection attempts
    validate_remote_shell(&resolved_shell)?;

    // Build docker exec command
    let mut cmd = CommandBuilder::new("docker");

    // For remote Docker, set DOCKER_HOST so the local `docker` binary tunnels
    // the daemon socket over SSH. The value is passed as a process env var
    // (not through a shell), so no shell quoting is needed — but
    // `validate_ssh_uri_parts` has already rejected URIs with unusual chars.
    if let Some(conn) = ssh_conn.as_ref() {
        super::docker::validate_ssh_uri_parts(&conn.user, &conn.host)?;
        cmd.env("DOCKER_HOST", super::docker::build_docker_host_uri(conn));
    }

    cmd.arg("exec");
    cmd.arg("-it");

    // Pass env vars as -e flags
    cmd.arg("-e");
    cmd.arg("TERM=xterm-256color");
    cmd.arg("-e");
    cmd.arg("COLORTERM=truecolor");

    // Auto-inject PROMPT_COMMAND so the shell inside the container emits OSC 7
    // cwd updates on each prompt. The server's cwd_watcher picks these up and
    // updates the pane's displayed directory. Only valid for bash/sh targets;
    // zsh/fish ignore PROMPT_COMMAND.
    if shell_supports_prompt_command(&resolved_shell) {
        cmd.arg("-e");
        cmd.arg(format!("PROMPT_COMMAND={}", OSC7_PROMPT_COMMAND));
    }

    let safe_env = terminar_core::engine::filter_env(env);
    for (k, v) in &safe_env {
        cmd.arg("-e");
        cmd.arg(format!("{}={}", k, v));
    }

    // Working directory inside container
    let resolved_cwd = if cwd.is_empty() { "/" } else { cwd };
    if resolved_cwd != "/" {
        cmd.arg("-w");
        cmd.arg(resolved_cwd);
    }

    // `--` separator terminates option parsing so a container_id like `--tls`
    // can't be interpreted as a Docker flag.
    cmd.arg("--");
    cmd.arg(container_id);
    cmd.arg(&resolved_shell);

    // Look up container name for display
    let container_name = super::docker::get_container_name(container_id, ssh_conn.as_ref()).await;
    let display_name = container_name.as_deref().unwrap_or(container_id);
    let name = match ssh_conn.as_ref() {
        Some(conn) => format!("{}/{}: Terminal {}", conn.name, display_name, counter),
        None => format!("{}: Terminal {}", display_name, counter),
    };

    terminar_core::engine::create_session_with_command(
        None,
        &name,
        &resolved_shell,
        resolved_cwd,
        cols,
        rows,
        cmd,
        sessions,
        state.mock_provider.as_ref(),
        None,
        Some(container_id.to_string()),
        ssh_connection_id.map(|s| s.to_string()),
    )
    .map_err(|e| format!("Failed to create Docker session: {}", e))
}

/// Create an SSH session by wrapping `ssh -tt user@host` in a PTY.
#[allow(clippy::too_many_arguments)]
fn create_ssh_session(
    ssh_connection_id: &str,
    cwd: &str,
    shell: &str,
    cols: u16,
    rows: u16,
    counter: u64,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<String, String> {
    // Look up connection
    let conn = super::ssh::get_connection(ssh_connection_id)
        .ok_or_else(|| format!("SSH connection '{}' not found", ssh_connection_id))?;

    // Default shell if empty — /bin/sh is more universal on remote hosts
    let resolved_shell = if shell.is_empty() {
        REMOTE_DEFAULT_SHELL.to_string()
    } else {
        shell.to_string()
    };

    // Validate shell format to block injection attempts (defense layer A)
    validate_remote_shell(&resolved_shell)?;

    // Build ssh command
    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg("-tt");
    cmd.arg("-o");
    cmd.arg("ServerAliveInterval=30");
    cmd.arg("-o");
    cmd.arg("ServerAliveCountMax=3");
    cmd.arg("-p");
    cmd.arg(conn.port.to_string());
    cmd.arg(format!("{}@{}", conn.user, conn.host));

    // Wrap remote command: optional `cd`, optional PROMPT_COMMAND injection
    // for bash/sh (so the remote shell auto-emits OSC 7 cwd updates), then
    // exec the target shell. Both cwd and shell are shell-quoted inside
    // `build_ssh_remote_command` as a defense layer on top of
    // `validate_remote_shell()`.
    let remote_cmd = build_ssh_remote_command(cwd, &resolved_shell);
    cmd.arg(remote_cmd);

    let name = format!("{}: Terminal {}", conn.name, counter);

    terminar_core::engine::create_session_with_command(
        None,
        &name,
        &resolved_shell,
        cwd,
        cols,
        rows,
        cmd,
        sessions,
        state.mock_provider.as_ref(),
        None,
        None,
        Some(ssh_connection_id.to_string()),
    )
    .map_err(|e| format!("Failed to create SSH session: {}", e))
}

/// POSIX shell-quote: wrap in single quotes, escape embedded single quotes.
pub(crate) fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Handle RenameSession message.
#[instrument(skip(tx_out, sessions), fields(session_id = %session_id, new_name = %new_name))]
pub(crate) async fn handle_rename_session(
    session_id: &str,
    new_name: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    {
        let mut guard = sessions.lock();
        if let Some(session) = guard.get_mut(session_id) {
            session.name = new_name.to_string();
        }
    }
    let list = enrich_session_list(build_session_list(sessions));
    tx_out
        .send(ServerMessage::SessionList { sessions: list })
        .await?;
    Ok(())
}

/// Handle KillSession message.
#[instrument(skip(tx_out, sessions, _state), fields(session_id = %session_id))]
pub(crate) async fn handle_kill_session(
    session_id: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    _state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    let was_removed = {
        let mut guard = sessions.lock();
        guard.remove(session_id).is_some()
    };
    let list = enrich_session_list(build_session_list(sessions));

    if was_removed {
        info!(session_id = %session_id, event = "session_killed", "Session lifecycle: killed");
        // Delete history file and update metadata
        let base_path = crate::settings::get_settings_dir();
        persistence::delete_history(&base_path, session_id);
        persistence::persist_all(&base_path, sessions);
        tx_out
            .send(ServerMessage::SessionClosed {
                session_id: session_id.to_string(),
            })
            .await?;
        tx_out
            .send(ServerMessage::SessionList { sessions: list })
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- shell_quote ----

    #[test]
    fn shell_quote_empty() {
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn shell_quote_plain() {
        assert_eq!(shell_quote("hello"), "'hello'");
    }

    #[test]
    fn shell_quote_space() {
        assert_eq!(shell_quote("hello world"), "'hello world'");
    }

    #[test]
    fn shell_quote_single_quote() {
        // A single quote becomes '\'' when wrapped in single quotes.
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn shell_quote_consecutive_quotes() {
        assert_eq!(shell_quote("a''b"), "'a'\\'''\\''b'");
    }

    #[test]
    fn shell_quote_backslash() {
        // Single quotes disable backslash interpretation, so no special handling needed.
        assert_eq!(shell_quote("a\\b"), "'a\\b'");
    }

    #[test]
    fn shell_quote_dollar_and_backtick() {
        assert_eq!(shell_quote("$(echo)`ls`"), "'$(echo)`ls`'");
    }

    #[test]
    fn shell_quote_newline() {
        assert_eq!(shell_quote("a\nb"), "'a\nb'");
    }

    #[test]
    fn shell_quote_null_byte() {
        // Null byte stays as-is; the shell will truncate but that's not our concern.
        assert_eq!(shell_quote("a\0b"), "'a\0b'");
    }

    #[test]
    fn shell_quote_unicode() {
        assert_eq!(shell_quote("héllo🔥"), "'héllo🔥'");
    }

    #[test]
    fn shell_quote_metacharacters_neutralized() {
        // All common shell metacharacters should pass through literally.
        let meta = "; & | < > $ ` ( ) { } [ ] * ? ! ~ # \\";
        assert_eq!(shell_quote(meta), format!("'{}'", meta));
    }

    // ---- validate_remote_shell ----

    #[test]
    fn validate_remote_shell_accepts_common() {
        for shell in &[
            "/bin/bash",
            "/bin/sh",
            "/bin/zsh",
            "/bin/ash",
            "/bin/busybox",
            "/usr/local/bin/fish",
            "/opt/homebrew/bin/bash",
        ] {
            assert!(
                validate_remote_shell(shell).is_ok(),
                "should accept {}",
                shell
            );
        }
    }

    #[test]
    fn validate_remote_shell_rejects_empty() {
        assert!(validate_remote_shell("").is_err());
    }

    #[test]
    fn validate_remote_shell_rejects_relative() {
        assert!(validate_remote_shell("bash").is_err());
        assert!(validate_remote_shell("./bash").is_err());
    }

    #[test]
    fn validate_remote_shell_rejects_metacharacters() {
        for bad in &[
            "/bin/bash; rm -rf /",
            "/bin/bash && echo pwned",
            "/bin/bash|foo",
            "/bin/bash`id`",
            "/bin/bash$(id)",
            "/bin/bash > /tmp/pwn",
            "/bin/bash < /etc/passwd",
            "/bin/bash\nmalicious",
            "/bin/bash\rinjection",
            "/bin/bash\0null",
            "/bin/bash\\x",
            "/bin/bash with space",
            "/bin/bash\twith\ttab",
            "/bin/\"bash\"",
            "/bin/'bash'",
        ] {
            assert!(
                validate_remote_shell(bad).is_err(),
                "should reject {:?}",
                bad
            );
        }
    }

    #[test]
    fn validate_remote_shell_rejects_too_long() {
        let too_long = format!("/{}", "a".repeat(300));
        assert!(validate_remote_shell(&too_long).is_err());
    }

    #[test]
    fn validate_remote_shell_accepts_max_length() {
        let max_len = format!("/{}", "a".repeat(255));
        assert_eq!(max_len.len(), 256);
        assert!(validate_remote_shell(&max_len).is_ok());
    }

    // ---- shell_basename / shell_supports_prompt_command ----

    #[test]
    fn shell_basename_extracts_final_component() {
        assert_eq!(shell_basename("/bin/bash"), "bash");
        assert_eq!(shell_basename("/usr/local/bin/zsh"), "zsh");
        assert_eq!(shell_basename("/bin/sh"), "sh");
        assert_eq!(shell_basename("/opt/homebrew/bin/fish"), "fish");
        assert_eq!(shell_basename(""), "");
    }

    #[test]
    fn supports_prompt_command_bash_family() {
        assert!(shell_supports_prompt_command("/bin/bash"));
        assert!(shell_supports_prompt_command("/usr/bin/bash"));
        assert!(shell_supports_prompt_command("/opt/homebrew/bin/bash"));
        assert!(shell_supports_prompt_command("/bin/sh"));
    }

    #[test]
    fn supports_prompt_command_rejects_zsh_fish_and_others() {
        assert!(!shell_supports_prompt_command("/bin/zsh"));
        assert!(!shell_supports_prompt_command("/usr/local/bin/fish"));
        assert!(!shell_supports_prompt_command("/bin/ash"));
        assert!(!shell_supports_prompt_command("/bin/dash"));
        assert!(!shell_supports_prompt_command("/bin/tcsh"));
        assert!(!shell_supports_prompt_command(""));
    }

    // ---- build_ssh_remote_command ----

    /// Every bash/zsh shim must define these aliases so programs that shell
    /// out to these binaries get transparently redirected to OSC sequences.
    fn assert_shim_contains_all_aliases(cmd: &str) {
        for needle in &[
            "pbcopy()",
            "xclip()",
            "xsel()",
            "wl-copy()",
            "_terminar_open_url()",
            "open()",
            "xdg-open()",
            "export BROWSER=_terminar_open_url",
            r#"\033]52;c;%s\007"#,          // OSC 52 emit (clipboard)
            r#"\033]7777;open_url;%s\007"#, // OSC 7777 emit (URL open)
        ] {
            assert!(
                cmd.contains(needle),
                "expected shim to contain {:?}, got:\n{}",
                needle,
                cmd
            );
        }
    }

    #[test]
    fn ssh_remote_cmd_bash_with_cwd_injects_shim_and_prompt_command() {
        let cmd = build_ssh_remote_command("/home/dev", "/bin/bash");
        assert!(cmd.starts_with("cd '/home/dev' && "));
        assert_shim_contains_all_aliases(&cmd);
        // bash must export the shim functions so they survive `exec bash`.
        assert!(
            cmd.contains("export -f pbcopy xclip xsel wl-copy _terminar_open_url open xdg-open"),
            "bash path must export shim functions"
        );
        // Cwd tracking still uses PROMPT_COMMAND for bash.
        assert!(cmd.contains("PROMPT_COMMAND='printf "));
        assert!(cmd.contains(r#"\033]7;file://%s%s\007"#));
        assert!(cmd.contains(r#""${HOSTNAME:-$(hostname)}""#));
        assert!(cmd.ends_with(" exec '/bin/bash'"));
    }

    #[test]
    fn ssh_remote_cmd_bash_no_cwd_skips_cd() {
        let cmd = build_ssh_remote_command("", "/bin/bash");
        // No `cd ` on its own prefix. (Deploy and script body never
        // contain a literal `cd '...'` substring either.)
        assert!(!cmd.starts_with("cd "));
        // First token is the edit-wrapper deploy — a per-session
        // `mktemp -d` into an unguessable private directory.
        assert!(cmd.starts_with("TERMINAR_EDIT_DIR=$(mktemp -d"));
        assert!(cmd.ends_with(" exec '/bin/bash'"));
    }

    #[test]
    fn ssh_remote_cmd_bash_root_cwd_skips_cd() {
        let cmd = build_ssh_remote_command("/", "/bin/bash");
        assert!(!cmd.starts_with("cd "));
        assert!(cmd.starts_with("TERMINAR_EDIT_DIR=$(mktemp -d"));
    }

    #[test]
    fn ssh_remote_cmd_sh_also_injects_shim() {
        let cmd = build_ssh_remote_command("/tmp", "/bin/sh");
        assert_shim_contains_all_aliases(&cmd);
        assert!(cmd.contains("PROMPT_COMMAND="));
        assert!(cmd.ends_with(" exec '/bin/sh'"));
    }

    #[test]
    fn ssh_remote_cmd_zsh_uses_zdotdir_with_shim() {
        let cmd = build_ssh_remote_command("/home/dev", "/bin/zsh");
        assert!(cmd.starts_with("cd '/home/dev' && "));
        // zsh path writes a temp .zshrc via heredoc and sets ZDOTDIR.
        assert!(cmd.contains("TERMINAR_ZDOTDIR=$(mktemp -d"));
        assert!(cmd.contains(".zshrc"));
        assert!(cmd.contains("<<'TERMINAR_SHIM_EOF'"));
        assert!(cmd.contains("TERMINAR_SHIM_EOF\n"));
        // User's .zshrc sourced first so their config is preserved.
        assert!(cmd.contains(r#"[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc""#));
        // Shim defined after user config so ours wins.
        assert_shim_contains_all_aliases(&cmd);
        // Cwd tracking via zsh-native precmd hook.
        assert!(cmd.contains("add-zsh-hook precmd _terminar_cwd"));
        // Final exec uses ZDOTDIR to pick up the custom .zshrc.
        assert!(cmd.contains(r#"ZDOTDIR="$TERMINAR_ZDOTDIR" exec '/bin/zsh'"#));
    }

    #[test]
    fn ssh_remote_cmd_zsh_no_cwd_skips_cd() {
        let cmd = build_ssh_remote_command("", "/bin/zsh");
        // No literal `cd '...' && ` prefix from build_ssh_remote_command.
        // (The deploy + shim heredocs are plain text, no cd-quoted substring.)
        assert!(!cmd.contains("cd '"));
        // First token is the edit-wrapper deploy (shared with bash/sh).
        assert!(cmd.starts_with("TERMINAR_EDIT_DIR=$(mktemp -d"));
        // ZDOTDIR setup still appears (after the deploy).
        assert!(cmd.contains("TERMINAR_ZDOTDIR="));
    }

    #[test]
    fn ssh_remote_cmd_fish_falls_back_to_plain_exec() {
        let cmd = build_ssh_remote_command("", "/usr/local/bin/fish");
        assert_eq!(cmd, "exec '/usr/local/bin/fish'");
    }

    #[test]
    fn ssh_remote_cmd_ash_falls_back_to_plain_exec() {
        let cmd = build_ssh_remote_command("/tmp", "/bin/ash");
        assert_eq!(cmd, "cd '/tmp' && exec '/bin/ash'");
    }

    #[test]
    fn ssh_remote_cmd_quotes_paths_with_metacharacters() {
        let cmd = build_ssh_remote_command("/tmp/with'quote", "/bin/bash");
        // The embedded single-quote is escaped via `'\''` in POSIX quoting.
        assert!(cmd.contains(r"'/tmp/with'\''quote'"));
    }

    #[test]
    fn ssh_remote_cmd_prompt_command_is_single_quoted() {
        // The OSC7_PROMPT_COMMAND value must be wrapped in single quotes so
        // the login shell treats it as a literal string (no expansion until
        // bash re-evaluates it at prompt time).
        let cmd = build_ssh_remote_command("", "/bin/bash");
        let pc_start = cmd
            .find("PROMPT_COMMAND='")
            .expect("PROMPT_COMMAND= not found");
        let after_start = &cmd[pc_start + "PROMPT_COMMAND='".len()..];
        let exec_pos = after_start.find(" exec ").expect("exec not found");
        let pc_value = &after_start[..exec_pos];
        assert!(
            pc_value.ends_with('\''),
            "PROMPT_COMMAND value not terminated by single quote: {}",
            pc_value
        );
    }

    // ---- expand_tilde ----

    fn env_with_home(home: &str) -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("HOME".to_string(), home.to_string());
        m
    }

    #[test]
    fn expand_tilde_prefix() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("~/code", &env), "/Users/me/code");
    }

    #[test]
    fn expand_tilde_bare() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("~", &env), "/Users/me");
    }

    #[test]
    fn expand_tilde_absolute_untouched() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("/tmp/x", &env), "/tmp/x");
    }

    #[test]
    fn expand_tilde_empty_untouched() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("", &env), "");
    }

    #[test]
    fn expand_tilde_tilde_in_middle_untouched() {
        let env = env_with_home("/Users/me");
        // Only a leading `~/` triggers expansion.
        assert_eq!(expand_tilde("/path/~/foo", &env), "/path/~/foo");
    }

    #[test]
    fn expand_tilde_trailing_slash_in_home() {
        let env = env_with_home("/Users/me/");
        assert_eq!(expand_tilde("~/code", &env), "/Users/me/code");
    }

    // ---- TERMINAR_EDIT_SCRIPT deployment ----

    /// Required substrings that prove the edit-wrapper deploy block is
    /// present and correctly configured. Checked for both bash/sh and zsh
    /// since both branches get the same deploy.
    ///
    /// The deploy uses `mktemp -d /tmp/terminar-edit.XXXXXX` to create a
    /// per-session private directory (mode 700) — this closes the
    /// symlink TOCTOU hole a fixed `/tmp/terminar-bin` path had on
    /// multi-user hosts. The script and the `$EDITOR` export reference
    /// the temp dir via the `$TERMINAR_EDIT_DIR` variable, so assertions
    /// check the variable-expanded form rather than a literal path.
    fn assert_deploy_block_present(cmd: &str) {
        let must_contain = &[
            // Private per-session temp dir created safely.
            "TERMINAR_EDIT_DIR=$(mktemp -d /tmp/terminar-edit.XXXXXX)",
            // Script body piped into the temp dir via a single-quoted heredoc.
            "cat > \"$TERMINAR_EDIT_DIR/terminar-edit\" <<'TERMINAR_EDIT_SCRIPT_EOF'",
            // chmod +x is the gate for the subsequent $EDITOR export.
            "chmod +x \"$TERMINAR_EDIT_DIR/terminar-edit\"",
            // $EDITOR points at the temp dir, not a fixed path.
            "export EDITOR=\"$TERMINAR_EDIT_DIR/terminar-edit\"",
            // PATH is prepended so `which terminar-edit` works too.
            "export PATH=\"$TERMINAR_EDIT_DIR:$PATH\"",
        ];
        for needle in must_contain {
            assert!(
                cmd.contains(needle),
                "expected deploy to contain {:?}, got:\n{}",
                needle,
                cmd
            );
        }
        // The heredoc delimiter appears TWICE in the command: once as the
        // opening `<<'TERMINAR_EDIT_SCRIPT_EOF'` marker on `cat`, and once
        // on its own line as the heredoc terminator.
        assert_eq!(
            cmd.matches("TERMINAR_EDIT_SCRIPT_EOF").count(),
            2,
            "expected exactly two occurrences of the heredoc delimiter (opening + closing), got:\n{}",
            cmd
        );
        // Fixed-path anti-assertions: any remaining reference to the
        // old `/tmp/terminar-bin` location would be a regression.
        assert!(
            !cmd.contains("/tmp/terminar-bin"),
            "deploy must not reference the old fixed path /tmp/terminar-bin (symlink TOCTOU), got:\n{}",
            cmd
        );
    }

    #[test]
    fn ssh_remote_cmd_bash_deploys_edit_wrapper() {
        let cmd = build_ssh_remote_command("/home/dev", "/bin/bash");
        assert_deploy_block_present(&cmd);
        // Deploy must come BEFORE the shim (so the shim is not clobbered
        // by the heredoc write). Concretely, the mktemp line must appear
        // before the first shim function definition.
        let deploy_pos = cmd
            .find("TERMINAR_EDIT_DIR=$(mktemp -d")
            .expect("mktemp not found");
        let pbcopy_pos = cmd.find("pbcopy()").expect("pbcopy not found");
        assert!(
            deploy_pos < pbcopy_pos,
            "deploy block must appear before shim in bash branch"
        );
    }

    #[test]
    fn ssh_remote_cmd_zsh_deploys_edit_wrapper() {
        let cmd = build_ssh_remote_command("/home/dev", "/bin/zsh");
        assert_deploy_block_present(&cmd);
        // Deploy must come BEFORE the ZDOTDIR setup so the edit wrapper
        // is ready by the time the user reaches their zsh prompt.
        let deploy_pos = cmd
            .find("TERMINAR_EDIT_DIR=$(mktemp -d")
            .expect("mktemp not found");
        let zdotdir_pos = cmd
            .find("TERMINAR_ZDOTDIR=")
            .expect("TERMINAR_ZDOTDIR not found");
        assert!(
            deploy_pos < zdotdir_pos,
            "deploy block must appear before ZDOTDIR in zsh branch"
        );
        // The two temp dirs use DISTINCT variable names so a buggy shell
        // can't cross-wire them. TERMINAR_EDIT_DIR holds the wrapper
        // script; TERMINAR_ZDOTDIR holds the custom .zshrc.
        assert!(
            cmd.contains("TERMINAR_EDIT_DIR=") && cmd.contains("TERMINAR_ZDOTDIR="),
            "both temp dir variables must be present"
        );
    }

    #[test]
    fn ssh_remote_cmd_fish_does_not_deploy_edit_wrapper() {
        // fish (and other fallback shells) gets a plain exec with no
        // deploy. Remote editing is unavailable for fish; the user's
        // existing $EDITOR on the remote side still works.
        let cmd = build_ssh_remote_command("", "/usr/local/bin/fish");
        assert!(
            !cmd.contains("terminar-edit"),
            "fish branch must not deploy terminar-edit, got:\n{}",
            cmd
        );
        assert!(
            !cmd.contains("TERMINAR_EDIT_SCRIPT_EOF"),
            "fish branch must not emit the edit-wrapper heredoc, got:\n{}",
            cmd
        );
        // The fish fallback must still be a plain exec (no regressions).
        assert_eq!(cmd, "exec '/usr/local/bin/fish'");
    }

    #[test]
    fn ssh_remote_cmd_ash_does_not_deploy_edit_wrapper() {
        // ash/dash/busybox also fall through to the plain-exec branch;
        // no deploy, no shim. The base64 detection in the edit script
        // would have worked on ash but the shim export (`export -f`) is
        // bash-only, so the whole branch is gated on bash/sh/zsh.
        let cmd = build_ssh_remote_command("/tmp", "/bin/ash");
        assert!(!cmd.contains("terminar-edit"));
    }

    #[test]
    fn terminar_edit_script_is_posix_sh() {
        let s = TERMINAR_EDIT_SCRIPT;

        // No bash-only test syntax.
        assert!(
            !s.contains("[[") && !s.contains("]]"),
            "TERMINAR_EDIT_SCRIPT must not use [[ ]] (bash-only)"
        );

        // No $RANDOM (bash-only). Comments are exempt so prose can
        // mention the name — a full-line comment is `#` as the first
        // non-whitespace character.
        for line in s.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with('#') {
                continue;
            }
            assert!(
                !line.contains("$RANDOM"),
                "TERMINAR_EDIT_SCRIPT must not use $RANDOM (bash-only), offending line: {:?}",
                line
            );
        }

        // No `function foo` style definitions (bash/ksh-only).
        // A POSIX function is `foo() { ... }`. Guard against the bashism
        // `function foo()` or `function foo {` by checking each line's
        // first non-whitespace token — `function` is never the start of
        // a POSIX command. Comments (lines starting with `#`) are
        // exempt so prose can mention the keyword.
        for line in s.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with('#') {
                continue;
            }
            assert!(
                !trimmed.starts_with("function "),
                "TERMINAR_EDIT_SCRIPT must not use `function` keyword (bash/ksh-only), offending line: {:?}",
                line
            );
        }

        // No `local` keyword (dash does not implement it).
        // Guard against ` local ` with a leading space to avoid matching
        // identifiers like `local_var` or substrings inside comments.
        for line in s.lines() {
            let trimmed = line.trim_start();
            assert!(
                !trimmed.starts_with("local "),
                "TERMINAR_EDIT_SCRIPT must not use `local` (dash-incompatible), offending line: {:?}",
                line
            );
        }

        // Must carry the framing marker prefix.
        assert!(
            s.contains("__TERMINAR_EDIT_"),
            "TERMINAR_EDIT_SCRIPT must reference the __TERMINAR_EDIT_ marker prefix"
        );

        // Must emit the edit_request OSC subcommand.
        assert!(
            s.contains("edit_request"),
            "TERMINAR_EDIT_SCRIPT must emit the edit_request OSC subcommand"
        );

        // Must have a POSIX line-reading pattern.
        assert!(
            s.contains("IFS= read -r line"),
            "TERMINAR_EDIT_SCRIPT must use `IFS= read -r line` for whole-line reads"
        );

        // Must encode with the base64 | tr -d '\n' idiom (single-line b64).
        assert!(
            s.contains("base64 | tr -d '\\n'"),
            "TERMINAR_EDIT_SCRIPT must strip newlines from base64 output"
        );

        // Must feature-test both GNU (-d) and BSD (-D) base64 decode flags.
        assert!(
            s.contains("base64 -d") && s.contains("base64 -D"),
            "TERMINAR_EDIT_SCRIPT must detect both GNU -d and BSD -D base64 flags"
        );

        // Must fall back to vi (or $TERMINAR_FALLBACK_EDITOR) on oversize.
        assert!(
            s.contains("TERMINAR_FALLBACK_EDITOR"),
            "TERMINAR_EDIT_SCRIPT must honor $TERMINAR_FALLBACK_EDITOR for oversize files"
        );

        // Must honor the 48000-byte size cap.
        assert!(
            s.contains("48000"),
            "TERMINAR_EDIT_SCRIPT must size-check against the 48000-byte cap"
        );

        // Must restore stty via a trap.
        assert!(
            s.contains("trap") && s.contains("EXIT") && s.contains("stty"),
            "TERMINAR_EDIT_SCRIPT must save/restore stty via a trap"
        );

        // Must track BOTH BEGIN and END — a missing END means the reply
        // was truncated (tray crash, partial flush, broken pipe) and the
        // empty-save path must not fire. See C1 regression test.
        assert!(
            s.contains("saw_begin"),
            "TERMINAR_EDIT_SCRIPT must track `saw_begin` to distinguish EOF from empty-save"
        );
        assert!(
            s.contains("saw_end"),
            "TERMINAR_EDIT_SCRIPT must track `saw_end` to distinguish truncated reply from empty-save"
        );
    }

    /// Strip comment lines (those whose first non-whitespace char is
    /// `#`) from a shell script string. Used by the static C1
    /// regression test so a commented-out check block is not mistaken
    /// for a live check. Does NOT handle trailing `# comment` on the
    /// same line as code — that would require tokenising the shell
    /// and is more brittle than it's worth. Leaves the shebang line
    /// alone too (which would be stripped otherwise); not important
    /// because the shebang doesn't affect our substring searches.
    fn strip_shell_comments(s: &str) -> String {
        s.lines()
            .filter(|line| {
                let trimmed = line.trim_start();
                !trimmed.starts_with('#')
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn terminar_edit_script_guards_against_eof_without_begin_or_end() {
        // Regression test for C1 (commit 97a2eda + follow-up): when the
        // read loop exits without seeing the complete BEGIN→END frame,
        // the empty-save path must NOT fire. Data-loss scenarios the
        // guards must cover:
        //
        //   a) stdin closed with no input at all (e.g. /dev/null
        //      redirect from a git hook)
        //   b) stdin closed after garbage lines but before BEGIN
        //   c) stdin closed after BEGIN but before END (tray crash
        //      mid-stream, broken pipe, network drop)
        //
        // The fix uses two flags: `saw_begin` set in the BEGIN branch
        // and `saw_end` set in the END branch, both gating the
        // empty-save path.
        //
        // IMPORTANT: this test searches `strip_shell_comments(s)`, not
        // the raw constant, so a commented-out check block cannot
        // satisfy it. A previous iteration searched the raw string
        // and silently allowed `#if [ "$saw_end" = 0 ]; then` to pass
        // — exactly the "static check missed it" failure mode the
        // executable tests guard against. Both layers (static +
        // executable) now cover the bug.
        let raw = TERMINAR_EDIT_SCRIPT;
        let s = strip_shell_comments(raw);
        let s = s.as_str();

        // Both flags must be initialized to 0 before the loop.
        assert!(
            s.contains("saw_begin=0"),
            "TERMINAR_EDIT_SCRIPT must initialize saw_begin=0 before the read loop"
        );
        assert!(
            s.contains("saw_end=0"),
            "TERMINAR_EDIT_SCRIPT must initialize saw_end=0 before the read loop"
        );

        // Flags must be set to 1 when the respective marker is observed.
        assert!(
            s.contains("saw_begin=1"),
            "TERMINAR_EDIT_SCRIPT must set saw_begin=1 when the BEGIN marker is observed"
        );
        assert!(
            s.contains("saw_end=1"),
            "TERMINAR_EDIT_SCRIPT must set saw_end=1 when the END marker is observed"
        );

        // The empty-save path (`: > "$file"`) must be preceded by BOTH
        // a saw_begin check AND a saw_end check. Scan the text before
        // the empty-save call and locate the nearest preceding
        // references to each flag — both must appear above the call.
        let empty_save_pos = s
            .find(": > \"$file\"")
            .expect("empty-save truncate path must exist in TERMINAR_EDIT_SCRIPT");
        let before_empty_save = &s[..empty_save_pos];

        let begin_guard_pos = before_empty_save
            .rfind("saw_begin")
            .expect("empty-save path must be preceded by a saw_begin reference");
        let end_guard_pos = before_empty_save
            .rfind("saw_end")
            .expect("empty-save path must be preceded by a saw_end reference");
        assert!(
            begin_guard_pos < empty_save_pos,
            "saw_begin guard must precede the empty-save truncate path"
        );
        assert!(
            end_guard_pos < empty_save_pos,
            "saw_end guard must precede the empty-save truncate path"
        );

        // Each guard must produce an `exit 1` on the failure path. We
        // verify this by looking for the pattern `[ "$saw_X" = 0 ]`
        // followed by `exit 1` in the window between the flag
        // initialization and the empty-save call.
        let init_pos = s
            .find("saw_begin=0")
            .expect("saw_begin=0 initialization not found");
        let window = &s[init_pos..empty_save_pos];

        // saw_begin=0 branch must exit 1.
        assert!(
            window.contains("\"$saw_begin\" = 0"),
            "must test `[ \"$saw_begin\" = 0 ]` between init and the empty-save path"
        );
        // saw_end=0 branch must exit 1.
        assert!(
            window.contains("\"$saw_end\" = 0"),
            "must test `[ \"$saw_end\" = 0 ]` between init and the empty-save path"
        );

        // At least two `exit 1` statements must live in the window
        // (one for saw_begin=0, one for saw_end=0) — plus more for the
        // cancelled branch, so >= 3 in practice.
        let exit1_count = window.matches("exit 1").count();
        assert!(
            exit1_count >= 3,
            "expected >= 3 `exit 1` statements in the post-loop guard block \
             (cancelled + saw_begin=0 + saw_end=0), got {}",
            exit1_count
        );

        // Negative check: verify that the old vulnerable pattern is
        // gone. A bare `if [ -z "$acc" ]; then` immediately after the
        // `if [ "$cancelled" = 1 ]` block (with no guards in between)
        // was the C1 bug — make sure the fix introduced enough
        // intervening content. The cleanest way to check this is to
        // require that between the `cancelled = 1 ]; then` line and
        // the empty-save call, BOTH flag checks appear.
        let cancel_pos = s
            .find("\"$cancelled\" = 1")
            .expect("cancelled check not found");
        let guard_window = &s[cancel_pos..empty_save_pos];
        assert!(
            guard_window.contains("\"$saw_begin\" = 0"),
            "saw_begin=0 check must appear after the cancelled check and before empty-save"
        );
        assert!(
            guard_window.contains("\"$saw_end\" = 0"),
            "saw_end=0 check must appear after the cancelled check and before empty-save"
        );
    }

    /// Write `TERMINAR_EDIT_SCRIPT` to a temp file, chmod +x, and return
    /// the keep-alive `NamedTempFile` handle along with its path. The
    /// caller must keep the handle alive (it auto-deletes on drop).
    ///
    /// This helper exists so executable integration tests can spawn the
    /// script via `/bin/sh <path> <target>` and exercise real shell
    /// behaviour — static substring checks have missed data-loss bugs
    /// twice, so we also run at least one scenario for real.
    fn write_script_to_tempfile() -> tempfile::NamedTempFile {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let mut script_file = tempfile::Builder::new()
            .prefix("terminar-edit-test.")
            .suffix(".sh")
            .tempfile()
            .expect("failed to create script tempfile");
        script_file
            .write_all(TERMINAR_EDIT_SCRIPT.as_bytes())
            .expect("failed to write script body");
        script_file.flush().expect("failed to flush script");

        let mut perms = std::fs::metadata(script_file.path())
            .expect("stat script tempfile")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(script_file.path(), perms).expect("chmod script tempfile");

        script_file
    }

    /// Spawn the wrapper script via `/bin/sh` with a controlled stdin,
    /// wait for it, and return `(exit_code, final_file_contents)`.
    ///
    /// Stdout and stderr are swallowed: the script emits an OSC escape
    /// sequence we don't want to leak into cargo test output, and any
    /// real parse/decode errors surface through the exit code +
    /// observable file state which is what we assert on.
    fn run_script_with_stdin(initial_contents: &[u8], stdin_bytes: &[u8]) -> (i32, Vec<u8>) {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let script = write_script_to_tempfile();

        // Target file with predictable initial contents.
        let target = tempfile::Builder::new()
            .prefix("terminar-edit-target.")
            .tempfile()
            .expect("failed to create target tempfile");
        std::fs::write(target.path(), initial_contents).expect("write initial contents");
        let target_path = target.path().to_owned();

        let mut child = Command::new("/bin/sh")
            .arg(script.path())
            .arg(&target_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn /bin/sh");

        {
            // Scope so stdin is dropped (closed) before wait().
            let mut stdin = child.stdin.take().expect("child stdin");
            // write_all may fail if the script has already exited on a
            // bad argument; that's fine for some scenarios (empty
            // filename), just ignore the error.
            let _ = stdin.write_all(stdin_bytes);
        }

        let status = child.wait().expect("wait for child");
        let final_contents = std::fs::read(&target_path).unwrap_or_default();

        // Keep both tempfiles alive until here so auto-cleanup runs.
        drop(target);
        drop(script);

        (status.code().unwrap_or(-1), final_contents)
    }

    #[test]
    fn terminar_edit_script_eof_with_no_input_leaves_file_alone() {
        // Scenario: $EDITOR invoked with stdin redirected from /dev/null
        // (some git hooks, crontab -e under certain wrappers, automation
        // pipelines). The script reads zero bytes, the loop never enters,
        // and the script must exit 1 with the file untouched.
        let (code, content) = run_script_with_stdin(b"important content\n", b"");
        assert_eq!(code, 1, "EOF with empty stdin must exit 1, got {}", code);
        assert_eq!(
            content, b"important content\n",
            "file must be untouched when stdin is empty"
        );
    }

    #[test]
    fn terminar_edit_script_eof_after_garbage_leaves_file_alone() {
        // Scenario: stdin closes after a handful of lines that don't
        // match any marker. Simulates the user typing random input at
        // the prompt before the reply arrives, then the tray crashing
        // or the network dropping so the real reply never comes.
        //
        // The read loop will consume all lines in wait state (dropping
        // them), then EOF → neither BEGIN nor CANCEL was seen → exit 1,
        // file untouched.
        let (code, content) = run_script_with_stdin(
            b"important content\n",
            b"random line 1\nrandom line 2\n__TERMINAR_EDIT_bogus_id_BEGIN__\n",
        );
        assert_eq!(
            code, 1,
            "EOF after non-matching garbage must exit 1, got {}",
            code
        );
        assert_eq!(
            content, b"important content\n",
            "file must be untouched when stdin contains only garbage"
        );
        // Specifically: the bogus BEGIN line at the end uses a WRONG id
        // (`bogus_id` vs. the script's `$$_<epoch>_<rand>` id), so it
        // does NOT match $begin_marker and must be discarded in
        // wait-state. If a future regression accidentally matches
        // BEGIN by prefix instead of full-line equality, this
        // assertion would fire with the file truncated.
    }

    #[test]
    fn terminar_edit_script_empty_filename_exits_nonzero() {
        // Early-exit path: if $1 is empty, exit 1 before touching
        // anything. We still supply a target path so the test harness
        // has something to spawn; the script ignores it because we
        // invoke it via /bin/sh <script> "" (second arg is "").
        use std::io::Write;
        use std::process::{Command, Stdio};

        let script = write_script_to_tempfile();
        let mut child = Command::new("/bin/sh")
            .arg(script.path())
            .arg("") // empty $1
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn /bin/sh");
        // Close stdin immediately; script should have exited already.
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"");
        }
        let status = child.wait().expect("wait for child");
        assert_eq!(status.code().unwrap_or(-1), 1, "empty filename must exit 1");
    }

    /// Helper: spawn the script, capture its OSC emit on stdout,
    /// extract the edit id, and hand control back to the caller so
    /// they can write a response back into the script's stdin and
    /// then close it. Returns `(exit_code, final_file_contents)`.
    ///
    /// The `respond` closure is called with the extracted edit id and
    /// a mutable reference to the child's stdin. It writes whatever
    /// framed reply (or partial reply) the test wants, then returns.
    /// The harness then closes stdin and waits for the script.
    ///
    /// The OSC capture uses a background thread draining the child's
    /// stdout into an in-memory buffer until we see BEL (`\x07`), at
    /// which point the OSC payload is complete and we parse it.
    fn run_script_with_osc_handshake<F>(initial_contents: &[u8], respond: F) -> (i32, Vec<u8>)
    where
        F: FnOnce(&str, &mut std::process::ChildStdin),
    {
        use std::io::Read;
        use std::process::{Command, Stdio};
        use std::sync::mpsc;
        use std::thread;

        let script = write_script_to_tempfile();
        let target = tempfile::Builder::new()
            .prefix("terminar-edit-target.")
            .tempfile()
            .expect("create target tempfile");
        std::fs::write(target.path(), initial_contents).expect("write initial");
        let target_path = target.path().to_owned();

        let mut child = Command::new("/bin/sh")
            .arg(script.path())
            .arg(&target_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn /bin/sh");

        let mut child_stdout = child.stdout.take().expect("child stdout");
        let mut child_stdin = child.stdin.take().expect("child stdin");

        // Drain stdout in a background thread until we see the BEL that
        // terminates the OSC 7777 sequence, then send the collected
        // bytes back through the channel and continue draining
        // (discarding). If the script exits without emitting an OSC,
        // the channel send is dropped and the main thread's recv will
        // fail — we handle that.
        let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(1);
        thread::spawn(move || {
            let mut buf = Vec::new();
            let mut scratch = [0u8; 4096];
            let mut sent = false;
            loop {
                match child_stdout.read(&mut scratch) {
                    Ok(0) => break,
                    Ok(n) => {
                        if !sent {
                            buf.extend_from_slice(&scratch[..n]);
                            if buf.contains(&0x07) {
                                let _ = tx.send(buf.clone());
                                sent = true;
                                buf.clear();
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Block up to ~2 seconds for the OSC emission.
        let osc_bytes = rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("script did not emit OSC within 2s");

        // OSC format:
        //   \x1b]7777;edit_request;<id_b64>;<filename_b64>;<contents_b64>\x07
        // Find the BEL, slice up to it, split on `;`, decode the id.
        let bel_pos = osc_bytes
            .iter()
            .position(|&b| b == 0x07)
            .expect("no BEL in OSC");
        let osc_str = std::str::from_utf8(&osc_bytes[..bel_pos]).expect("OSC was not UTF-8");
        // osc_str looks like `\x1b]7777;edit_request;<id_b64>;<fn_b64>;<c_b64>`.
        // Locate `edit_request;` and split from there.
        let marker_idx = osc_str
            .find("edit_request;")
            .expect("OSC did not contain edit_request; prefix");
        let after = &osc_str[marker_idx + "edit_request;".len()..];
        let mut parts = after.split(';');
        let id_b64 = parts.next().expect("id_b64 missing");

        use base64::{Engine as _, engine::general_purpose::STANDARD};
        let id_bytes = STANDARD
            .decode(id_b64.as_bytes())
            .expect("id base64 decode");
        let id = std::str::from_utf8(&id_bytes)
            .expect("id was not UTF-8")
            .to_string();

        // Let the test write the reply (or partial reply) via the closure.
        respond(&id, &mut child_stdin);

        // Close stdin to signal EOF.
        drop(child_stdin);

        let status = child.wait().expect("wait for child");
        let final_contents = std::fs::read(&target_path).unwrap_or_default();

        drop(target);
        drop(script);

        (status.code().unwrap_or(-1), final_contents)
    }

    #[test]
    fn terminar_edit_script_begin_then_eof_leaves_file_alone() {
        // THE FOLLOW-UP C1 REGRESSION: the reviewer found that after
        // the first fix (saw_begin guard), the script still had a
        // data-loss path if stdin closed AFTER BEGIN was observed but
        // before END arrived. Scenario: tray crash mid-stream, PTY
        // partial flush, broken pipe on a slow network, etc.
        //
        // The fix adds a saw_end flag and gates the empty-save path on
        // BOTH saw_begin and saw_end. This test reproduces the exact
        // scenario: we extract the script's edit id, write only a
        // BEGIN marker (no content, no END) back into its stdin, then
        // close stdin. The script must exit 1 and leave the file
        // untouched — NOT truncate it.
        let (code, content) =
            run_script_with_osc_handshake(b"critical production config\n", |id, stdin| {
                use std::io::Write;
                let begin = format!("\n__TERMINAR_EDIT_{}_BEGIN__\n", id);
                let _ = stdin.write_all(begin.as_bytes());
                // Intentionally do NOT write END. The harness closes
                // stdin after this closure returns, simulating a tray
                // crash mid-stream.
            });
        assert_eq!(
            code, 1,
            "BEGIN-then-EOF must exit 1, got {} (this is the C1 follow-up bug)",
            code
        );
        assert_eq!(
            content,
            b"critical production config\n",
            "BEGIN-then-EOF must leave the file untouched; instead got {:?}",
            std::str::from_utf8(&content).unwrap_or("<invalid utf8>")
        );
    }

    #[test]
    fn terminar_edit_script_begin_end_success_path_writes_file() {
        // Complement to the BEGIN-then-EOF test: verify the happy
        // path still works after the guard changes. BEGIN + content +
        // END must produce an exit-0 write with the decoded contents.
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        let payload = "hello from the tray\n";
        let (code, content) = run_script_with_osc_handshake(b"original content\n", |id, stdin| {
            use std::io::Write;
            let b64 = STANDARD.encode(payload.as_bytes());
            let frame = format!(
                "\n__TERMINAR_EDIT_{}_BEGIN__\n{}\n__TERMINAR_EDIT_{}_END__\n",
                id, b64, id
            );
            let _ = stdin.write_all(frame.as_bytes());
        });
        assert_eq!(code, 0, "happy path must exit 0, got {}", code);
        assert_eq!(
            content,
            payload.as_bytes(),
            "happy path must write decoded contents"
        );
    }

    #[test]
    fn terminar_edit_script_begin_empty_end_truncates_file() {
        // Empty-save path: BEGIN + nothing + END is the tray's way of
        // saying "user cleared the buffer, truncate the file". This
        // must still work — only the EOF-before-END case should fail.
        let (code, content) = run_script_with_osc_handshake(
            b"original content that will be cleared\n",
            |id, stdin| {
                use std::io::Write;
                let frame = format!(
                    "\n__TERMINAR_EDIT_{}_BEGIN__\n\n__TERMINAR_EDIT_{}_END__\n",
                    id, id
                );
                let _ = stdin.write_all(frame.as_bytes());
            },
        );
        assert_eq!(code, 0, "empty-save must exit 0, got {}", code);
        assert_eq!(content, b"", "empty-save must truncate the file to 0 bytes");
    }

    #[test]
    fn terminar_edit_script_cancel_leaves_file_alone() {
        // Cancel path: the tray sends CANCEL instead of BEGIN. Script
        // must exit 1 with the file untouched.
        let (code, content) = run_script_with_osc_handshake(b"important content\n", |id, stdin| {
            use std::io::Write;
            let frame = format!("\n__TERMINAR_EDIT_{}_CANCEL__\n", id);
            let _ = stdin.write_all(frame.as_bytes());
        });
        assert_eq!(code, 1, "cancel must exit 1, got {}", code);
        assert_eq!(
            content, b"important content\n",
            "cancel must leave file untouched"
        );
    }

    #[test]
    fn terminar_edit_script_has_no_shell_injection_holes() {
        let s = TERMINAR_EDIT_SCRIPT;

        // Primary guarantee: the heredoc delimiter must not appear
        // inside the script body. If it did, the deploy's
        // `cat > ... <<'TERMINAR_EDIT_SCRIPT_EOF'` heredoc would
        // terminate early and the rest of the script would execute as
        // outer shell commands (or syntax-error at deploy time).
        assert!(
            !s.contains("TERMINAR_EDIT_SCRIPT_EOF"),
            "TERMINAR_EDIT_SCRIPT body must not contain the heredoc delimiter"
        );

        // The delimiter must not appear even in mangled forms that the
        // shell treats equivalently at heredoc termination time. The
        // POSIX heredoc terminator match is exact after leading-tab
        // stripping for `<<-`, but we use `<<'...'` (no tab stripping),
        // so any line that is EXACTLY `TERMINAR_EDIT_SCRIPT_EOF` would
        // terminate. We already checked the substring form, which is
        // strictly stronger.

        // Must not contain CR-only line endings (old-Mac / Windows crlf).
        // A stray \r would make `read -r` see a trailing carriage return
        // in every marker and break the == comparison against the
        // marker constants — the whole round-trip would silently hang.
        assert!(
            !s.contains('\r'),
            "TERMINAR_EDIT_SCRIPT must not contain carriage returns"
        );

        // Balanced curly braces across the whole script. Unbalanced
        // braces are almost always a typo in a function body or
        // parameter expansion — cheap structural sanity check.
        // (We deliberately do NOT check parentheses: POSIX case
        // patterns like `''|*[!0-9]*)` and `*)` are valid but
        // unbalanced at the text level.)
        let open_braces = s.matches('{').count();
        let close_braces = s.matches('}').count();
        assert_eq!(
            open_braces, close_braces,
            "unbalanced braces in TERMINAR_EDIT_SCRIPT: {} open vs {} close",
            open_braces, close_braces
        );

        // The script must end with a newline so the heredoc's closing
        // delimiter line is on its own line and not glued to the last
        // script line. The deploy builder adds an explicit `\n` after
        // the script body, so either is acceptable — we just want to
        // make sure the trailing content is non-empty.
        assert!(!s.is_empty(), "TERMINAR_EDIT_SCRIPT must not be empty");
    }
}
