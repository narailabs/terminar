//! Message handler modules extracted from lib.rs.
//!
//! Each module handles a group of related `ClientMessage` variants:
//! - `session`: CreateSession, KillSession, RenameSession, ListSessions
//! - `io`: Input, Resize, Attach
//! - `workspace`: SaveWorkspace, LoadWorkspace

pub mod io;
pub mod session;
pub mod workspace;
