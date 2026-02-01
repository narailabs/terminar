//! Message handler modules extracted from lib.rs.
//!
//! Each module handles a group of related `ClientMessage` variants:
//! - `session`: CreateSession, KillSession, RenameSession, ListSessions
//! - `io`: Input, Resize, Attach
//! - `auth`: PairRequest
//! - `workspace`: SaveWorkspace, LoadWorkspace

pub mod auth;
pub mod io;
pub mod session;
pub mod workspace;
