//! Foreground process detection for PTY sessions.
//!
//! This module provides functions to detect the foreground process running in a PTY:
//! - `get_foreground_process()` uses the PTY's raw fd to call `tcgetpgrp` and resolve
//!   the process group leader to a process name.
//! - `resolve_process_name()` looks up a PID's name using platform-specific APIs.
//! - `extract_binary_name_from_cmdline()` extracts the actual binary name from command
//!   lines where `comm` reports a generic runtime like `node` or `python`.

use std::os::unix::io::{BorrowedFd, RawFd};
#[cfg(target_os = "macos")]
use std::mem;

/// Wrapper processes (interpreters/runtimes) that may mask the real binary name.
/// When `comm` reports one of these, we fall back to inspecting the full command line.
const WRAPPER_PROCESSES: &[&str] = &["node", "python", "python3", "ruby", "perl", "java", "deno", "bun"];

/// Get the foreground process name for a PTY session.
///
/// Uses `tcgetpgrp()` on the PTY file descriptor to get the foreground process group ID,
/// then resolves that PGID to a process name using platform-specific APIs.
///
/// Returns `None` if:
/// - The fd is invalid
/// - `tcgetpgrp` fails (e.g., not a terminal fd)
/// - The process name cannot be resolved
pub fn get_foreground_process(pty_fd: RawFd) -> Option<String> {
    // Reject invalid file descriptors before creating BorrowedFd
    if pty_fd < 0 {
        return None;
    }

    // Safety: The fd is valid for the lifetime of the Session which owns it.
    // We only borrow it briefly for the tcgetpgrp syscall. We've checked fd >= 0 above.
    let borrowed = unsafe { BorrowedFd::borrow_raw(pty_fd) };
    let pgid = nix::unistd::tcgetpgrp(borrowed).ok()?;
    let pid = pgid.as_raw();

    resolve_process_name(pid)
}

/// Get the current working directory for the foreground process of a PTY session.
///
/// Uses `tcgetpgrp()` on the PTY file descriptor to get the foreground process group ID,
/// then resolves that PGID's CWD using platform-specific APIs.
///
/// Returns `None` if:
/// - The fd is invalid
/// - `tcgetpgrp` fails
/// - The CWD cannot be resolved
pub fn get_process_cwd(pty_fd: RawFd) -> Option<String> {
    if pty_fd < 0 {
        return None;
    }

    let borrowed = unsafe { BorrowedFd::borrow_raw(pty_fd) };
    let pgid = nix::unistd::tcgetpgrp(borrowed).ok()?;
    let pid = pgid.as_raw();

    resolve_process_cwd(pid)
}

/// Resolve the current working directory of a process by PID.
///
/// Platform-specific:
/// - **macOS**: Uses `proc_pidinfo` with `PROC_PIDVNODEPATHINFO` to get `vip_path`.
/// - **Linux**: Reads `/proc/<pid>/cwd` symlink.
#[cfg(target_os = "macos")]
fn resolve_process_cwd(pid: i32) -> Option<String> {
    // Use proc_pidinfo with PROC_PIDVNODEPATHINFO to get the CWD
    let mut vnode_info: libc::proc_vnodepathinfo = unsafe { mem::zeroed() };
    let ret = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut vnode_info as *mut _ as *mut libc::c_void,
            mem::size_of::<libc::proc_vnodepathinfo>() as i32,
        )
    };

    if ret <= 0 {
        return None;
    }

    // vip_path is [[c_char; 32]; 32] (libc workaround for [c_char; 1024])
    // Flatten to a single byte slice and find the null terminator
    let flat: Vec<u8> = vnode_info.pvi_cdir.vip_path
        .iter()
        .flat_map(|chunk| chunk.iter())
        .map(|&b| b as u8)
        .collect();
    let nul_pos = flat.iter().position(|&b| b == 0).unwrap_or(flat.len());
    let path = std::str::from_utf8(&flat[..nul_pos]).ok()?;

    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

#[cfg(target_os = "linux")]
fn resolve_process_cwd(pid: i32) -> Option<String> {
    std::fs::read_link(format!("/proc/{}/cwd", pid))
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()))
}

/// Resolve a process name from a PID.
///
/// Platform-specific:
/// - **macOS**: Uses `libc::proc_pidpath` to get the full executable path, then
///   extracts the binary name. Falls back to shelling out to `ps`.
/// - **Linux**: Reads `/proc/<pid>/comm`, falls back to `/proc/<pid>/cmdline`.
///
/// If the resolved name is a wrapper process (e.g., `node`, `python`), attempts
/// to extract the real binary name from the full command line.
pub fn resolve_process_name(pid: i32) -> Option<String> {
    let name = resolve_process_name_raw(pid)?;

    // If the process name is a wrapper (node, python, etc.), try to get the real binary
    if WRAPPER_PROCESSES.contains(&name.as_str()) {
        if let Some(cmdline) = get_process_cmdline(pid) {
            if let Some(real_name) = extract_binary_name_from_cmdline(&cmdline) {
                return Some(real_name);
            }
        }
    }

    Some(name)
}

/// Check if a string looks like a version number (e.g., "2.1.29", "1.0.0-beta").
/// This happens when proc_pidpath resolves symlinks to versioned directories.
fn looks_like_version(name: &str) -> bool {
    // Version strings typically start with a digit and contain dots
    name.starts_with(|c: char| c.is_ascii_digit())
        && name.contains('.')
        && name.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-' || c.is_ascii_alphanumeric())
}

/// Get the raw process name (comm) without wrapper resolution.
#[cfg(target_os = "macos")]
fn resolve_process_name_raw(pid: i32) -> Option<String> {
    // Try proc_pidpath first (gives full path like /usr/local/bin/node)
    let mut buf = [0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let ret = unsafe {
        libc::proc_pidpath(
            pid,
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len() as u32,
        )
    };

    if ret > 0 {
        let path = std::str::from_utf8(&buf[..ret as usize]).ok()?;
        let binary = std::path::Path::new(path)
            .file_name()?
            .to_str()?
            .to_string();
        // proc_pidpath resolves symlinks, so a binary like "claude" symlinked to
        // ".../versions/2.1.29" would return "2.1.29" instead of "claude".
        // Detect version-like names and fall back to proc_name.
        if looks_like_version(&binary) {
            // Fall through to proc_name fallback
        } else {
            return Some(binary);
        }
    }

    // Fallback: use proc_name (shorter, limited to 16 chars on some systems)
    let mut name_buf = [0u8; 256];
    let ret = unsafe {
        libc::proc_name(
            pid,
            name_buf.as_mut_ptr() as *mut libc::c_void,
            name_buf.len() as u32,
        )
    };

    if ret > 0 {
        let name = std::str::from_utf8(&name_buf[..ret as usize]).ok()?;
        return Some(name.to_string());
    }

    None
}

/// Get the raw process name (comm) without wrapper resolution.
#[cfg(target_os = "linux")]
fn resolve_process_name_raw(pid: i32) -> Option<String> {
    // Try /proc/<pid>/comm first
    if let Ok(comm) = std::fs::read_to_string(format!("/proc/{}/comm", pid)) {
        let name = comm.trim().to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }

    // Fallback: /proc/<pid>/cmdline (null-separated args)
    if let Ok(cmdline_bytes) = std::fs::read(format!("/proc/{}/cmdline", pid)) {
        if let Some(first_arg) = cmdline_bytes.split(|&b| b == 0).next() {
            if let Ok(arg) = std::str::from_utf8(first_arg) {
                let binary = std::path::Path::new(arg)
                    .file_name()?
                    .to_str()?
                    .to_string();
                return Some(binary);
            }
        }
    }

    None
}

/// Get the full command line for a process.
#[cfg(target_os = "macos")]
fn get_process_cmdline(pid: i32) -> Option<String> {
    // On macOS, use `ps -p <pid> -o args=` to get the full command line
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
        .ok()?;

    if output.status.success() {
        let cmdline = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !cmdline.is_empty() {
            return Some(cmdline);
        }
    }

    None
}

/// Get the full command line for a process.
#[cfg(target_os = "linux")]
fn get_process_cmdline(pid: i32) -> Option<String> {
    let cmdline_bytes = std::fs::read(format!("/proc/{}/cmdline", pid)).ok()?;
    // /proc/<pid>/cmdline uses null bytes as separators
    let cmdline = cmdline_bytes
        .split(|&b| b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).to_string())
        .collect::<Vec<_>>()
        .join(" ");

    if cmdline.is_empty() {
        None
    } else {
        Some(cmdline)
    }
}

/// Extract the actual binary name from a command line where the process name
/// reports a generic runtime like `node` or `python`.
///
/// This handles cases like:
/// - `/usr/local/bin/node /usr/local/bin/gemini` -> `gemini`
/// - `/usr/bin/python3 /usr/local/bin/aider` -> `aider`
/// - `node ./scripts/build.js` -> `build.js`
///
/// Returns `None` if there's no second argument or the cmdline is empty.
pub fn extract_binary_name_from_cmdline(cmdline: &str) -> Option<String> {
    let parts: Vec<&str> = cmdline.split_whitespace().collect();

    // Need at least 2 parts: the runtime and the script/binary
    if parts.len() < 2 {
        return None;
    }

    // The second argument is the script/binary being run
    let script_path = parts[1];

    // Skip common node/python flags (e.g., `node --inspect script.js`)
    let script_path = if script_path.starts_with('-') {
        // Find the first non-flag argument
        parts.iter().skip(1).find(|p| !p.starts_with('-'))?
    } else {
        script_path
    };

    // Extract just the filename from the path
    let name = std::path::Path::new(script_path)
        .file_name()?
        .to_str()?
        .to_string();

    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== F2a Tests ====================

    // Test: get_foreground_process returns None for invalid file descriptor
    #[test]
    fn test_get_foreground_process_returns_none_for_invalid_fd() {
        let result = get_foreground_process(-1);
        assert!(result.is_none(), "Invalid fd should return None");
    }

    // Test: get_foreground_process returns None for non-terminal fd (e.g., a regular file)
    #[test]
    fn test_get_foreground_process_returns_none_for_non_terminal_fd() {
        use std::os::unix::io::AsRawFd;
        // fd 0 (stdin) might not be a terminal in test environments
        // Use a pipe fd which is definitely not a terminal
        let (read_fd, write_fd) = nix::unistd::pipe().expect("pipe() should succeed");
        let result = get_foreground_process(read_fd.as_raw_fd());
        assert!(result.is_none(), "Non-terminal fd should return None");
        // Clean up
        drop(read_fd);
        drop(write_fd);
    }

    // Test: resolve_process_name returns None for non-existent PID
    #[test]
    fn test_resolve_process_name_returns_none_for_nonexistent_pid() {
        // PID 99999999 is extremely unlikely to exist
        let result = resolve_process_name(99999999);
        assert!(result.is_none(), "Non-existent PID should return None");
    }

    // Test: resolve_process_name returns a name for the current process
    #[test]
    fn test_resolve_process_name_returns_name_for_current_process() {
        let pid = std::process::id() as i32;
        let result = resolve_process_name(pid);
        assert!(result.is_some(), "Current process PID should resolve to a name");
        // The test binary name should contain "terminar" or be a cargo test runner
        let name = result.unwrap();
        assert!(!name.is_empty(), "Process name should not be empty");
    }

    // Test: resolve_process_name returns a name for PID 1 (launchd/init)
    #[test]
    fn test_resolve_process_name_returns_name_for_pid_1() {
        let result = resolve_process_name(1);
        assert!(result.is_some(), "PID 1 should resolve to a name");
        let name = result.unwrap();
        #[cfg(target_os = "macos")]
        assert_eq!(name, "launchd", "PID 1 on macOS should be launchd");
        #[cfg(target_os = "linux")]
        {
            // On Linux, PID 1 could be "systemd", "init", etc.
            assert!(!name.is_empty(), "PID 1 name should not be empty");
        }
    }

    // Test: extract_binary_name_from_cmdline extracts gemini from node path
    #[test]
    fn test_extract_binary_name_extracts_gemini_from_node_cmdline() {
        let cmdline = "/usr/local/bin/node /usr/local/bin/gemini";
        let result = extract_binary_name_from_cmdline(cmdline);
        assert_eq!(result, Some("gemini".to_string()));
    }

    // Test: extract_binary_name_from_cmdline extracts aider from python cmdline
    #[test]
    fn test_extract_binary_name_extracts_aider_from_python_cmdline() {
        let cmdline = "/usr/bin/python3 /usr/local/bin/aider";
        let result = extract_binary_name_from_cmdline(cmdline);
        assert_eq!(result, Some("aider".to_string()));
    }

    // Test: extract_binary_name_from_cmdline returns None for empty cmdline
    #[test]
    fn test_extract_binary_name_returns_none_for_empty_cmdline() {
        let result = extract_binary_name_from_cmdline("");
        assert!(result.is_none(), "Empty cmdline should return None");
    }

    // Test: extract_binary_name_from_cmdline returns None for single arg
    #[test]
    fn test_extract_binary_name_returns_none_for_single_arg() {
        let result = extract_binary_name_from_cmdline("/usr/local/bin/node");
        assert!(result.is_none(), "Single arg cmdline should return None");
    }

    // Test: extract_binary_name_from_cmdline handles relative paths
    #[test]
    fn test_extract_binary_name_handles_relative_paths() {
        let cmdline = "node ./scripts/build.js";
        let result = extract_binary_name_from_cmdline(cmdline);
        assert_eq!(result, Some("build.js".to_string()));
    }

    // Test: extract_binary_name_from_cmdline handles node with flags
    #[test]
    fn test_extract_binary_name_handles_flags() {
        let cmdline = "node --inspect /usr/local/bin/gemini";
        let result = extract_binary_name_from_cmdline(cmdline);
        assert_eq!(result, Some("gemini".to_string()));
    }

    // Test: extract_binary_name_from_cmdline handles just a binary name (no path)
    #[test]
    fn test_extract_binary_name_handles_bare_binary() {
        let cmdline = "python3 aider";
        let result = extract_binary_name_from_cmdline(cmdline);
        assert_eq!(result, Some("aider".to_string()));
    }

    // Test: extract_binary_name_from_cmdline handles multiple flags before script
    #[test]
    fn test_extract_binary_name_skips_multiple_flags() {
        let cmdline = "node --max-old-space-size=4096 --inspect /usr/local/bin/codex";
        let result = extract_binary_name_from_cmdline(cmdline);
        assert_eq!(result, Some("codex".to_string()));
    }

    // Test: extract_binary_name_from_cmdline returns None for only flags, no script
    #[test]
    fn test_extract_binary_name_returns_none_when_only_flags() {
        let cmdline = "node --version";
        let result = extract_binary_name_from_cmdline(cmdline);
        // --version is a flag, but since there's no non-flag argument, returns None
        assert!(result.is_none(), "Only flags should return None");
    }

    // Test: looks_like_version detects version strings
    #[test]
    fn test_looks_like_version() {
        assert!(looks_like_version("2.1.29"));
        assert!(looks_like_version("1.0.0"));
        assert!(looks_like_version("0.12.3-beta"));
        assert!(!looks_like_version("claude"));
        assert!(!looks_like_version("node"));
        assert!(!looks_like_version("zsh"));
        assert!(!looks_like_version(""));
    }

    // Test: WRAPPER_PROCESSES constant contains expected runtimes
    #[test]
    fn test_wrapper_processes_contains_expected_runtimes() {
        assert!(WRAPPER_PROCESSES.contains(&"node"));
        assert!(WRAPPER_PROCESSES.contains(&"python"));
        assert!(WRAPPER_PROCESSES.contains(&"python3"));
        assert!(WRAPPER_PROCESSES.contains(&"ruby"));
        assert!(WRAPPER_PROCESSES.contains(&"java"));
        assert!(WRAPPER_PROCESSES.contains(&"deno"));
        assert!(WRAPPER_PROCESSES.contains(&"bun"));
    }

    // Test: resolve_process_name_raw returns a name for current PID
    #[test]
    fn test_resolve_process_name_raw_returns_name_for_current_pid() {
        let pid = std::process::id() as i32;
        let result = resolve_process_name_raw(pid);
        assert!(result.is_some(), "Current PID should have a raw name");
        assert!(!result.unwrap().is_empty(), "Raw name should not be empty");
    }

    // Test: resolve_process_name_raw returns None for invalid PID
    #[test]
    fn test_resolve_process_name_raw_returns_none_for_invalid_pid() {
        let result = resolve_process_name_raw(99999999);
        assert!(result.is_none(), "Invalid PID should return None from raw resolver");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_process_cmdline_for_current_process() {
        let pid = std::process::id() as i32;
        let result = get_process_cmdline(pid);
        assert!(result.is_some(), "Current process should have a command line");
        let cmdline = result.unwrap();
        assert!(!cmdline.is_empty(), "Command line should not be empty");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_get_process_cmdline_for_current_process() {
        let pid = std::process::id() as i32;
        let result = get_process_cmdline(pid);
        assert!(result.is_some(), "Current process should have a command line");
        let cmdline = result.unwrap();
        assert!(!cmdline.is_empty(), "Command line should not be empty");
    }

    // Test: get_process_cmdline returns None for non-existent PID
    #[test]
    fn test_get_process_cmdline_returns_none_for_nonexistent_pid() {
        let result = get_process_cmdline(99999999);
        assert!(result.is_none(), "Non-existent PID should have no cmdline");
    }

    // ==================== CWD Detection Tests ====================

    #[test]
    fn test_get_process_cwd_returns_none_for_invalid_fd() {
        let result = get_process_cwd(-1);
        assert!(result.is_none(), "Invalid fd should return None");
    }

    #[test]
    fn test_get_process_cwd_returns_none_for_non_terminal_fd() {
        use std::os::unix::io::AsRawFd;
        let (read_fd, write_fd) = nix::unistd::pipe().expect("pipe() should succeed");
        let result = get_process_cwd(read_fd.as_raw_fd());
        assert!(result.is_none(), "Non-terminal fd should return None");
        drop(read_fd);
        drop(write_fd);
    }

    #[test]
    fn test_resolve_process_cwd_returns_path_for_current_process() {
        let pid = std::process::id() as i32;
        let result = resolve_process_cwd(pid);
        assert!(result.is_some(), "Current process should have a CWD");
        let cwd = result.unwrap();
        assert!(!cwd.is_empty(), "CWD should not be empty");
        assert!(cwd.starts_with('/'), "CWD should be an absolute path");
    }

    #[test]
    fn test_resolve_process_cwd_returns_none_for_nonexistent_pid() {
        let result = resolve_process_cwd(99999999);
        assert!(result.is_none(), "Non-existent PID should return None");
    }
}
