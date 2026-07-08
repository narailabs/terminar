//! Message handler modules extracted from lib.rs.
//!
//! Each module handles a group of related `ClientMessage` variants:
//! - `session`: CreateSession, KillSession, RenameSession, ListSessions
//! - `io`: Input, Resize, Attach
//! - `workspace`: SaveWorkspace, LoadWorkspace, GetWorkspaceState, PutWorkspaceState
//! - `docker`: ListContainers, container validation
//! - `ssh`: SSH connection CRUD, config import, lookup
//! - `config`: GetSettings/PutSettings, GetThemes/PutThemes, GetTags/PutTags

pub mod config;
pub mod docker;
pub mod io;
pub mod session;
pub mod ssh;
pub mod workspace;
