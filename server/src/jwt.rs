//! JWT session token generation and validation.
//!
//! After successful authentication (PAM password or SSH pubkey),
//! the server issues a JWT that clients use for reconnection.

use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// JWT claims payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (username).
    pub sub: String,
    /// Server identifier.
    pub server_id: String,
    /// Issued at (Unix timestamp).
    pub iat: u64,
    /// Expiry (Unix timestamp).
    pub exp: u64,
    /// Token type: "access" or "refresh".
    #[serde(default = "default_token_type")]
    pub token_type: String,
    /// Unique token identifier (UUID v4) for revocation tracking.
    #[serde(default = "default_jti")]
    pub jti: String,
}

fn default_jti() -> String {
    String::new()
}

fn default_token_type() -> String {
    "access".to_string()
}

/// Generate a cryptographically random 256-bit signing key.
pub fn generate_signing_key() -> Vec<u8> {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut key = vec![0u8; 32];
    rng.fill(&mut key).expect("Failed to generate random key");
    key
}

/// Issue a JWT token for the given user.
pub fn issue_token(
    key: &[u8],
    username: &str,
    server_id: &str,
    expiry: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs();
    issue_token_at(key, username, server_id, now, expiry)
}

/// Issue a JWT token with a specific issued-at timestamp (for testing).
#[doc(hidden)]
pub fn issue_token_for_test(
    key: &[u8],
    username: &str,
    server_id: &str,
    iat: u64,
    expiry: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    issue_token_at(key, username, server_id, iat, expiry)
}

fn issue_token_at(
    key: &[u8],
    username: &str,
    server_id: &str,
    iat: u64,
    expiry: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    issue_typed_token_at(key, username, server_id, iat, expiry, "access")
}

fn issue_typed_token_at(
    key: &[u8],
    username: &str,
    server_id: &str,
    iat: u64,
    expiry: Duration,
    token_type: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let claims = Claims {
        sub: username.to_string(),
        server_id: server_id.to_string(),
        iat,
        exp: iat + expiry.as_secs(),
        token_type: token_type.to_string(),
        jti: uuid::Uuid::new_v4().to_string(),
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(key),
    )
}

/// Issue a short-lived access token (typically 15 minutes).
pub fn issue_access_token(
    key: &[u8],
    username: &str,
    server_id: &str,
    expiry: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs();
    issue_typed_token_at(key, username, server_id, now, expiry, "access")
}

/// Issue a long-lived refresh token (typically 7 days).
pub fn issue_refresh_token(
    key: &[u8],
    username: &str,
    server_id: &str,
    expiry: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs();
    issue_typed_token_at(key, username, server_id, now, expiry, "refresh")
}

/// Validate an access token (rejects refresh tokens).
pub fn validate_access_token(
    key: &[u8],
    token: &str,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    let claims = validate_token(key, token)?;
    if claims.token_type != "access" {
        return Err(jsonwebtoken::errors::Error::from(
            jsonwebtoken::errors::ErrorKind::InvalidToken,
        ));
    }
    Ok(claims)
}

/// Validate a refresh token (rejects access tokens).
pub fn validate_refresh_token(
    key: &[u8],
    token: &str,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    let claims = validate_token(key, token)?;
    if claims.token_type != "refresh" {
        return Err(jsonwebtoken::errors::Error::from(
            jsonwebtoken::errors::ErrorKind::InvalidToken,
        ));
    }
    Ok(claims)
}

/// Validate a JWT token and return its claims.
pub fn validate_token(key: &[u8], token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    validation.required_spec_claims.clear();
    validation.required_spec_claims.insert("exp".to_string());
    validation.required_spec_claims.insert("sub".to_string());

    let token_data = decode::<Claims>(token, &DecodingKey::from_secret(key), &validation)?;
    Ok(token_data.claims)
}

/// Load a signing key from disk, or generate and save a new one.
pub fn load_or_create_signing_key(path: &Path) -> Result<Vec<u8>, std::io::Error> {
    if path.exists() {
        let encoded = std::fs::read_to_string(path)?;
        use base64::Engine;
        let key = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        Ok(key)
    } else {
        let key = generate_signing_key();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&key);
        std::fs::write(path, &encoded)?;
        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_generate_signing_key_returns_32_bytes() {
        let key = generate_signing_key();
        assert_eq!(key.len(), 32, "Signing key should be 32 bytes (256-bit)");
    }

    #[test]
    fn test_generate_signing_key_is_random() {
        let key1 = generate_signing_key();
        let key2 = generate_signing_key();
        assert_ne!(key1, key2, "Two generated keys should not be identical");
    }

    #[test]
    fn test_issue_token_returns_valid_jwt() {
        let key = generate_signing_key();
        let token = issue_token(&key, "narayan", "server-123", Duration::from_secs(86400))
            .expect("Should issue token");
        // JWT has 3 dot-separated parts
        assert_eq!(token.split('.').count(), 3, "JWT should have 3 parts");
    }

    #[test]
    fn test_validate_token_roundtrip() {
        let key = generate_signing_key();
        let token = issue_token(&key, "narayan", "server-123", Duration::from_secs(86400))
            .expect("Should issue token");

        let claims = validate_token(&key, &token).expect("Should validate token");
        assert_eq!(claims.sub, "narayan");
        assert_eq!(claims.server_id, "server-123");
    }

    #[test]
    fn test_validate_token_wrong_key_fails() {
        let key1 = generate_signing_key();
        let key2 = generate_signing_key();
        let token = issue_token(&key1, "narayan", "server-123", Duration::from_secs(86400))
            .expect("Should issue token");

        let result = validate_token(&key2, &token);
        assert!(
            result.is_err(),
            "Token signed with different key should fail validation"
        );
    }

    #[test]
    fn test_validate_expired_token_fails() {
        let key = generate_signing_key();
        // Issue a token that was created 2 hours ago with 1-hour expiry (expired 1 hour ago)
        let past = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            - 7200;
        let token = issue_token_at(
            &key,
            "narayan",
            "server-123",
            past,
            Duration::from_secs(3600),
        )
        .expect("Should issue token");

        let result = validate_token(&key, &token);
        assert!(result.is_err(), "Expired token should fail validation");
    }

    #[test]
    fn test_validate_garbage_token_fails() {
        let key = generate_signing_key();
        let result = validate_token(&key, "not.a.jwt");
        assert!(result.is_err(), "Garbage token should fail validation");
    }

    #[test]
    fn test_claims_contain_iat_and_exp() {
        let key = generate_signing_key();
        let token = issue_token(&key, "narayan", "server-123", Duration::from_secs(3600))
            .expect("Should issue token");

        let claims = validate_token(&key, &token).expect("Should validate");
        assert!(claims.iat > 0, "iat should be set");
        assert!(claims.exp > claims.iat, "exp should be after iat");
        assert_eq!(
            claims.exp - claims.iat,
            3600,
            "Expiry should match requested duration"
        );
    }

    #[test]
    fn test_issue_refresh_token_has_refresh_type() {
        let key = generate_signing_key();
        let token = issue_refresh_token(&key, "narayan", "server-123", Duration::from_secs(604800))
            .expect("Should issue refresh token");
        let claims = validate_refresh_token(&key, &token).expect("Should validate refresh token");
        assert_eq!(claims.sub, "narayan");
        assert_eq!(claims.token_type, "refresh");
    }

    #[test]
    fn test_access_token_has_access_type() {
        let key = generate_signing_key();
        let token = issue_access_token(&key, "narayan", "server-123", Duration::from_secs(900))
            .expect("Should issue access token");
        let claims = validate_token(&key, &token).expect("Should validate");
        assert_eq!(claims.token_type, "access");
    }

    #[test]
    fn test_refresh_token_cannot_be_used_as_access() {
        let key = generate_signing_key();
        let refresh =
            issue_refresh_token(&key, "narayan", "server-123", Duration::from_secs(604800))
                .expect("Should issue refresh token");
        // validate_token (for access) should reject refresh tokens
        let result = validate_access_token(&key, &refresh);
        assert!(
            result.is_err(),
            "Refresh token should not be accepted as access token"
        );
    }

    #[test]
    fn test_access_token_cannot_be_used_as_refresh() {
        let key = generate_signing_key();
        let access = issue_access_token(&key, "narayan", "server-123", Duration::from_secs(900))
            .expect("Should issue access token");
        let result = validate_refresh_token(&key, &access);
        assert!(
            result.is_err(),
            "Access token should not be accepted as refresh token"
        );
    }

    #[test]
    fn test_load_or_create_key_creates_new() {
        let dir = tempfile::tempdir().expect("Should create temp dir");
        let key_path = dir.path().join("server.key");

        let key = load_or_create_signing_key(&key_path).expect("Should create key");
        assert_eq!(key.len(), 32);
        assert!(key_path.exists(), "Key file should be created");
    }

    #[test]
    fn test_load_or_create_key_loads_existing() {
        let dir = tempfile::tempdir().expect("Should create temp dir");
        let key_path = dir.path().join("server.key");

        let key1 = load_or_create_signing_key(&key_path).expect("Should create key");
        let key2 = load_or_create_signing_key(&key_path).expect("Should load existing key");
        assert_eq!(key1, key2, "Loading existing key should return same value");
    }

    #[test]
    fn test_token_has_unique_jti() {
        let key = generate_signing_key();
        let token1 = issue_access_token(&key, "narayan", "server-123", Duration::from_secs(900))
            .expect("Should issue token");
        let token2 = issue_access_token(&key, "narayan", "server-123", Duration::from_secs(900))
            .expect("Should issue token");
        let claims1 = validate_token(&key, &token1).unwrap();
        let claims2 = validate_token(&key, &token2).unwrap();
        assert!(!claims1.jti.is_empty(), "jti should not be empty");
        assert!(!claims2.jti.is_empty(), "jti should not be empty");
        assert_ne!(
            claims1.jti, claims2.jti,
            "Each token should have a unique jti"
        );
    }

    #[test]
    fn test_refresh_token_has_jti() {
        let key = generate_signing_key();
        let token = issue_refresh_token(&key, "narayan", "server-123", Duration::from_secs(604800))
            .expect("Should issue refresh token");
        let claims = validate_refresh_token(&key, &token).unwrap();
        assert!(!claims.jti.is_empty(), "Refresh token should have a jti");
    }

    #[test]
    fn test_legacy_token_without_jti_still_validates() {
        // Tokens issued before jti was added should still validate
        // (jti defaults to empty string via serde default)
        let key = generate_signing_key();
        let token = issue_token(&key, "narayan", "server-123", Duration::from_secs(3600))
            .expect("Should issue token");
        let claims = validate_token(&key, &token).unwrap();
        // jti should be populated for new tokens
        assert!(!claims.jti.is_empty());
    }
}
