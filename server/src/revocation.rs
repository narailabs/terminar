//! Persistent token revocation store.
//!
//! Stores revoked token IDs in a JSONL (JSON Lines) file for persistence across
//! server restarts. On load, expired entries are pruned automatically.
//! New revocations are appended via a background writer task.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::Mutex;
use serde::{Serialize, Deserialize};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

/// A single entry in the revocation file.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RevocationEntry {
    /// The revoked token identifier (jti or full token string).
    token_id: String,
    /// ISO 8601 timestamp when the token was revoked.
    revoked_at: String,
    /// Reason for revocation (e.g., "rotation", "manual", "logout").
    reason: String,
    /// Token's original expiry time (Unix timestamp), used for pruning.
    #[serde(default)]
    exp: Option<u64>,
}

/// Persistent store for revoked tokens.
///
/// Maintains an in-memory HashSet for fast `is_revoked` checks and a JSONL file
/// for persistence. New revocations are written asynchronously via a background task.
pub struct RevocationStore {
    revoked: Arc<Mutex<HashSet<String>>>,
    writer_tx: mpsc::UnboundedSender<RevocationEntry>,
    flush_tx: mpsc::Sender<tokio::sync::oneshot::Sender<()>>,
}

impl RevocationStore {
    /// Create a new RevocationStore backed by the given file path.
    ///
    /// On creation, loads existing entries from the file, pruning any that have
    /// expired (where `exp < now`). Starts a background writer task for appending
    /// new revocations.
    pub async fn new(path: PathBuf) -> std::io::Result<Self> {
        // Load existing entries
        let mut revoked = HashSet::new();
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        if path.exists() {
            let contents = tokio::fs::read_to_string(&path).await?;
            for line in contents.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(entry) = serde_json::from_str::<RevocationEntry>(line) {
                    // Prune expired entries
                    if let Some(exp) = entry.exp
                        && exp < now_secs {
                            continue; // Skip expired
                        }
                    revoked.insert(entry.token_id);
                }
            }
        }

        // Open file for appending
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;

        let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<RevocationEntry>();
        let (flush_tx, mut flush_rx) = mpsc::channel::<tokio::sync::oneshot::Sender<()>>(1);

        tokio::spawn(async move {
            let mut writer = tokio::io::BufWriter::new(file);
            loop {
                tokio::select! {
                    biased;

                    msg = writer_rx.recv() => {
                        match msg {
                            Some(entry) => {
                                if let Ok(json) = serde_json::to_string(&entry) {
                                    let _ = writer.write_all(json.as_bytes()).await;
                                    let _ = writer.write_all(b"\n").await;
                                }
                            }
                            None => break,
                        }
                    }
                    msg = flush_rx.recv() => {
                        match msg {
                            Some(done) => {
                                // Drain pending writes before flushing
                                while let Ok(entry) = writer_rx.try_recv() {
                                    if let Ok(json) = serde_json::to_string(&entry) {
                                        let _ = writer.write_all(json.as_bytes()).await;
                                        let _ = writer.write_all(b"\n").await;
                                    }
                                }
                                let _ = writer.flush().await;
                                let _ = done.send(());
                            }
                            None => break,
                        }
                    }
                }
            }
            let _ = writer.flush().await;
        });

        Ok(Self {
            revoked: Arc::new(Mutex::new(revoked)),
            writer_tx,
            flush_tx,
        })
    }

    /// Revoke a token by its ID. The revocation is immediately visible in memory
    /// and asynchronously persisted to disk.
    pub fn revoke(&self, token_id: &str, reason: &str, exp: Option<u64>) {
        self.revoked.lock().insert(token_id.to_string());

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let entry = RevocationEntry {
            token_id: token_id.to_string(),
            revoked_at: crate::audit::unix_secs_to_iso8601(now_secs),
            reason: reason.to_string(),
            exp,
        };
        let _ = self.writer_tx.send(entry);
    }

    /// Check if a token has been revoked.
    pub fn is_revoked(&self, token_id: &str) -> bool {
        self.revoked.lock().contains(token_id)
    }

    /// Flush all pending writes to disk.
    pub async fn flush(&self) {
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let _ = self.flush_tx.send(done_tx).await;
        let _ = done_rx.await;
    }

    /// Returns the number of revoked tokens currently tracked.
    pub fn len(&self) -> usize {
        self.revoked.lock().len()
    }

    /// Returns true if no tokens are currently revoked.
    pub fn is_empty(&self) -> bool {
        self.revoked.lock().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_revocation_persistence_roundtrip() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("revoked-tokens.jsonl");

        // Create store and revoke a token
        let store = RevocationStore::new(path.clone()).await.unwrap();
        store.revoke("token-123", "rotation", Some(u64::MAX));
        store.flush().await;

        assert!(store.is_revoked("token-123"));
        assert!(!store.is_revoked("token-456"));

        // Reload from disk
        let store2 = RevocationStore::new(path).await.unwrap();
        assert!(store2.is_revoked("token-123"));
        assert!(!store2.is_revoked("token-456"));
    }

    #[tokio::test]
    async fn test_prune_expired_tokens() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("revoked-tokens.jsonl");

        // Manually write an expired entry
        let expired_entry = RevocationEntry {
            token_id: "expired-token".to_string(),
            revoked_at: "1000Z".to_string(),
            reason: "test".to_string(),
            exp: Some(1000), // Long expired
        };
        let valid_entry = RevocationEntry {
            token_id: "valid-token".to_string(),
            revoked_at: "1000Z".to_string(),
            reason: "test".to_string(),
            exp: Some(u64::MAX), // Far future
        };

        let mut content = serde_json::to_string(&expired_entry).unwrap();
        content.push('\n');
        content.push_str(&serde_json::to_string(&valid_entry).unwrap());
        content.push('\n');
        tokio::fs::write(&path, &content).await.unwrap();

        // Load — expired entry should be pruned
        let store = RevocationStore::new(path).await.unwrap();
        assert!(!store.is_revoked("expired-token"));
        assert!(store.is_revoked("valid-token"));
        assert_eq!(store.len(), 1);
    }

    #[tokio::test]
    async fn test_revoke_multiple_tokens() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("revoked-tokens.jsonl");

        let store = RevocationStore::new(path.clone()).await.unwrap();
        store.revoke("token-a", "rotation", None);
        store.revoke("token-b", "logout", None);
        store.revoke("token-c", "manual", None);
        store.flush().await;

        assert!(store.is_revoked("token-a"));
        assert!(store.is_revoked("token-b"));
        assert!(store.is_revoked("token-c"));
        assert_eq!(store.len(), 3);

        // Verify persistence
        let store2 = RevocationStore::new(path).await.unwrap();
        assert_eq!(store2.len(), 3);
    }

    #[tokio::test]
    async fn test_empty_file_loads_ok() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("revoked-tokens.jsonl");

        // Create an empty file
        tokio::fs::write(&path, "").await.unwrap();

        let store = RevocationStore::new(path).await.unwrap();
        assert_eq!(store.len(), 0);
    }

    #[tokio::test]
    async fn test_nonexistent_file_creates_new() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("subdir").join("revoked-tokens.jsonl");

        let store = RevocationStore::new(path.clone()).await.unwrap();
        store.revoke("test-token", "test", None);
        store.flush().await;

        assert!(path.exists());
    }

    #[tokio::test]
    async fn test_entries_without_exp_are_kept() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("revoked-tokens.jsonl");

        let entry = RevocationEntry {
            token_id: "no-exp-token".to_string(),
            revoked_at: "1000Z".to_string(),
            reason: "test".to_string(),
            exp: None, // No expiry
        };
        let content = format!("{}\n", serde_json::to_string(&entry).unwrap());
        tokio::fs::write(&path, &content).await.unwrap();

        let store = RevocationStore::new(path).await.unwrap();
        assert!(store.is_revoked("no-exp-token"));
    }

    #[tokio::test]
    async fn test_refresh_rotation_revokes_old_token() {
        use crate::jwt;
        use std::time::Duration;

        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("revoked-tokens.jsonl");
        let store = RevocationStore::new(path).await.unwrap();

        let key = jwt::generate_signing_key();

        // Issue a refresh token
        let refresh = jwt::issue_refresh_token(&key, "narayan", "srv-1", Duration::from_secs(604800))
            .expect("Should issue refresh token");
        let claims = jwt::validate_refresh_token(&key, &refresh).unwrap();
        let old_jti = claims.jti.clone();

        // Simulate rotation: revoke old token
        store.revoke(&old_jti, "rotation", Some(claims.exp));
        store.flush().await;

        // Old token's jti should be revoked
        assert!(store.is_revoked(&old_jti));

        // Issue new tokens (simulating what the handler does)
        let new_access = jwt::issue_access_token(&key, "narayan", "srv-1", Duration::from_secs(900))
            .expect("Should issue new access token");
        let new_refresh = jwt::issue_refresh_token(&key, "narayan", "srv-1", Duration::from_secs(604800))
            .expect("Should issue new refresh token");

        // New tokens should be valid
        let new_access_claims = jwt::validate_access_token(&key, &new_access).unwrap();
        let new_refresh_claims = jwt::validate_refresh_token(&key, &new_refresh).unwrap();

        // New tokens' jtis should NOT be revoked
        assert!(!store.is_revoked(&new_access_claims.jti));
        assert!(!store.is_revoked(&new_refresh_claims.jti));

        // All jtis should be unique
        assert_ne!(old_jti, new_access_claims.jti);
        assert_ne!(old_jti, new_refresh_claims.jti);
        assert_ne!(new_access_claims.jti, new_refresh_claims.jti);
    }

    #[tokio::test]
    async fn test_revoked_refresh_token_cannot_be_reused() {
        use crate::jwt;
        use std::time::Duration;

        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("revoked-tokens.jsonl");
        let store = RevocationStore::new(path).await.unwrap();

        let key = jwt::generate_signing_key();

        // Issue and immediately revoke a refresh token
        let refresh = jwt::issue_refresh_token(&key, "narayan", "srv-1", Duration::from_secs(604800))
            .expect("Should issue refresh token");
        let claims = jwt::validate_refresh_token(&key, &refresh).unwrap();
        store.revoke(&claims.jti, "rotation", Some(claims.exp));

        // The JWT itself is still cryptographically valid...
        assert!(jwt::validate_refresh_token(&key, &refresh).is_ok());
        // ...but the revocation store marks it as revoked
        assert!(store.is_revoked(&claims.jti));
    }
}
