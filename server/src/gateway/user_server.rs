//! Per-user server lifecycle management.
//!
//! The `UserServerManager` spawns and tracks terminar-server instances
//! running in `--user-mode`, one per authenticated user. Each server
//! listens on a Unix socket in the configured socket directory and is
//! launched via `sudo -u <username>` for privilege separation.

// UserServerManager implementation will be added in Task 21.
