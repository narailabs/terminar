//! Authentication module: PAM password auth, SSH pubkey challenge-response.
//!
//! Uses a trait-based approach so PAM can be mocked in tests.

use crate::jwt;
use std::path::Path;
use std::time::Duration;

/// Result of a successful authentication.
#[derive(Debug)]
pub struct AuthResult {
    /// JWT session token.
    pub token: String,
    /// Token expiry as ISO 8601 string.
    pub expires: String,
}

/// Trait for password verification — mockable for tests.
pub trait PasswordVerifier: Send + Sync {
    fn verify(&self, username: &str, password: &str) -> Result<(), String>;
}

/// Real PAM-based password verifier.
pub struct PamVerifier {
    /// PAM service name (e.g., "terminar").
    service: String,
}

impl PamVerifier {
    pub fn new(service: &str) -> Self {
        Self { service: service.to_string() }
    }
}

impl PasswordVerifier for PamVerifier {
    fn verify(&self, username: &str, password: &str) -> Result<(), String> {
        // Use direct PAM FFI via libpam (available on macOS and Linux).
        // This avoids needing pam-client/pam-sys which require libclang for bindgen.
        pam_ffi::authenticate(&self.service, username, password)
    }
}

/// Creates the appropriate platform-specific password verifier.
///
/// - macOS/Linux: Returns a PAM verifier.
/// - Windows: Returns a Win32 LogonUser verifier.
pub fn create_platform_verifier(service: &str) -> Option<Box<dyn PasswordVerifier>> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        Some(Box::new(PamVerifier::new(service)))
    }
    #[cfg(target_os = "windows")]
    {
        Some(Box::new(WinVerifier::new()))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = service;
        None
    }
}

/// Windows password verifier using LogonUserW Win32 API.
#[cfg(target_os = "windows")]
pub struct WinVerifier;

#[cfg(target_os = "windows")]
impl WinVerifier {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
impl PasswordVerifier for WinVerifier {
    fn verify(&self, username: &str, password: &str) -> Result<(), String> {
        // Windows LogonUserW API call
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;

        let username_wide: Vec<u16> = OsStr::new(username).encode_wide().chain(Some(0)).collect();
        let password_wide: Vec<u16> = OsStr::new(password).encode_wide().chain(Some(0)).collect();
        let domain_wide: Vec<u16> = OsStr::new(".").encode_wide().chain(Some(0)).collect();

        let mut token: *mut std::ffi::c_void = ptr::null_mut();

        extern "system" {
            fn LogonUserW(
                username: *const u16,
                domain: *const u16,
                password: *const u16,
                logon_type: u32,
                logon_provider: u32,
                token: *mut *mut std::ffi::c_void,
            ) -> i32;
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }

        const LOGON32_LOGON_INTERACTIVE: u32 = 2;
        const LOGON32_PROVIDER_DEFAULT: u32 = 0;

        let result = unsafe {
            LogonUserW(
                username_wide.as_ptr(),
                domain_wide.as_ptr(),
                password_wide.as_ptr(),
                LOGON32_LOGON_INTERACTIVE,
                LOGON32_PROVIDER_DEFAULT,
                &mut token,
            )
        };

        if result != 0 {
            if !token.is_null() {
                unsafe { CloseHandle(token); }
            }
            Ok(())
        } else {
            Err("Windows authentication failed".to_string())
        }
    }
}

/// Direct FFI bindings to libpam. Avoids the pam-client crate's libclang dependency.
mod pam_ffi {
    use std::ffi::{CString, c_void, c_int, c_char};
    use std::ptr;

    // PAM constants
    const PAM_SUCCESS: c_int = 0;
    const PAM_PROMPT_ECHO_OFF: c_int = 1; // Password prompt (no echo)

    // PAM conversation message
    #[repr(C)]
    struct PamMessage {
        msg_style: c_int,
        msg: *const c_char,
    }

    // PAM conversation response
    #[repr(C)]
    struct PamResponse {
        resp: *mut c_char,
        resp_retcode: c_int,
    }

    // PAM conversation function signature
    type PamConvFn = extern "C" fn(
        num_msg: c_int,
        msg: *mut *const PamMessage,
        resp: *mut *mut PamResponse,
        appdata_ptr: *mut c_void,
    ) -> c_int;

    // PAM conversation structure
    #[repr(C)]
    struct PamConv {
        conv: PamConvFn,
        appdata_ptr: *mut c_void,
    }

    // Opaque PAM handle
    enum PamHandle {}

    #[link(name = "pam")]
    unsafe extern "C" {
        fn pam_start(
            service_name: *const c_char,
            user: *const c_char,
            pam_conversation: *const PamConv,
            pamh: *mut *mut PamHandle,
        ) -> c_int;

        fn pam_authenticate(pamh: *mut PamHandle, flags: c_int) -> c_int;
        fn pam_acct_mgmt(pamh: *mut PamHandle, flags: c_int) -> c_int;
        fn pam_end(pamh: *mut PamHandle, pam_status: c_int) -> c_int;
        fn pam_strerror(pamh: *mut PamHandle, errnum: c_int) -> *const c_char;
    }

    /// Conversation callback that provides the password to PAM.
    extern "C" fn pam_conversation(
        num_msg: c_int,
        msg: *mut *const PamMessage,
        resp: *mut *mut PamResponse,
        appdata_ptr: *mut c_void,
    ) -> c_int {
        unsafe {
            let password = &*(appdata_ptr as *const CString);

            // Allocate response array
            let responses = libc::calloc(num_msg as usize, std::mem::size_of::<PamResponse>())
                as *mut PamResponse;
            if responses.is_null() {
                return 19; // PAM_BUF_ERR
            }

            for i in 0..num_msg as isize {
                let m = *msg.offset(i);
                if (*m).msg_style == PAM_PROMPT_ECHO_OFF {
                    // Provide password - PAM will free this
                    let pwd = libc::strdup(password.as_ptr());
                    (*responses.offset(i)).resp = pwd;
                    (*responses.offset(i)).resp_retcode = 0;
                }
            }

            *resp = responses;
            PAM_SUCCESS
        }
    }

    pub fn authenticate(service: &str, username: &str, password: &str) -> Result<(), String> {
        let service_c = CString::new(service).map_err(|_| "Invalid service name")?;
        let user_c = CString::new(username).map_err(|_| "Invalid username")?;
        let pass_c = CString::new(password).map_err(|_| "Invalid password")?;

        unsafe {
            let conv = PamConv {
                conv: pam_conversation,
                appdata_ptr: &pass_c as *const CString as *mut c_void,
            };

            let mut pamh: *mut PamHandle = ptr::null_mut();

            let ret = pam_start(service_c.as_ptr(), user_c.as_ptr(), &conv, &mut pamh);
            if ret != PAM_SUCCESS {
                return Err(format!("PAM init failed (code {})", ret));
            }

            let ret = pam_authenticate(pamh, 0);
            if ret != PAM_SUCCESS {
                let err = pam_strerror(pamh, ret);
                let msg = if err.is_null() {
                    format!("Authentication failed (code {})", ret)
                } else {
                    let s = std::ffi::CStr::from_ptr(err).to_string_lossy().to_string();
                    format!("Authentication failed: {}", s)
                };
                pam_end(pamh, ret);
                return Err(msg);
            }

            let ret = pam_acct_mgmt(pamh, 0);
            if ret != PAM_SUCCESS {
                let err = pam_strerror(pamh, ret);
                let msg = if err.is_null() {
                    format!("Account validation failed (code {})", ret)
                } else {
                    let s = std::ffi::CStr::from_ptr(err).to_string_lossy().to_string();
                    format!("Account validation failed: {}", s)
                };
                pam_end(pamh, ret);
                return Err(msg);
            }

            pam_end(pamh, PAM_SUCCESS);
            Ok(())
        }
    }
}

/// Handle password authentication: verify via PAM, issue JWT on success.
pub fn handle_password_auth(
    verifier: &dyn PasswordVerifier,
    signing_key: &[u8],
    server_id: &str,
    username: &str,
    password: &str,
    token_expiry: Duration,
) -> Result<AuthResult, String> {
    // Verify password
    verifier.verify(username, password)?;

    // Issue JWT
    let token = jwt::issue_token(signing_key, username, server_id, token_expiry)
        .map_err(|e| format!("Failed to issue token: {}", e))?;

    // Calculate expiry timestamp
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs() + token_expiry.as_secs();

    // Format as ISO 8601
    let expires = format_unix_timestamp(expires_at);

    Ok(AuthResult { token, expires })
}

/// Validate a JWT token for reconnection.
pub fn handle_token_auth(
    signing_key: &[u8],
    token: &str,
) -> Result<AuthResult, String> {
    let claims = jwt::validate_token(signing_key, token)
        .map_err(|e| format!("Token validation failed: {}", e))?;

    let expires = format_unix_timestamp(claims.exp);

    Ok(AuthResult {
        token: token.to_string(),
        expires,
    })
}

/// Read authorized SSH public keys from ~/.ssh/authorized_keys for a user.
pub fn read_authorized_keys(home_dir: &Path) -> Result<Vec<String>, String> {
    let auth_keys_path = home_dir.join(".ssh").join("authorized_keys");
    if !auth_keys_path.exists() {
        return Ok(Vec::new());
    }

    let contents = std::fs::read_to_string(&auth_keys_path)
        .map_err(|e| format!("Failed to read authorized_keys: {}", e))?;

    let keys: Vec<String> = contents
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.trim().starts_with('#'))
        .map(|line| {
            // authorized_keys format: algorithm base64key comment
            // We want just "algorithm base64key"
            let parts: Vec<&str> = line.trim().splitn(3, ' ').collect();
            if parts.len() >= 2 {
                format!("{} {}", parts[0], parts[1])
            } else {
                line.trim().to_string()
            }
        })
        .collect();

    Ok(keys)
}

/// Generate a cryptographic nonce for SSH pubkey challenge.
pub fn generate_nonce() -> String {
    use base64::Engine;
    let mut nonce = vec![0u8; 32];
    use ring::rand::{SystemRandom, SecureRandom};
    let rng = SystemRandom::new();
    rng.fill(&mut nonce).expect("Failed to generate nonce");
    base64::engine::general_purpose::STANDARD.encode(&nonce)
}

/// State for an in-progress SSH pubkey challenge-response.
#[derive(Debug, Clone)]
pub struct PubkeyChallenge {
    /// The public key string from authorized_keys ("algorithm base64key").
    pub pubkey: String,
    /// The nonce sent to the client (base64-encoded).
    pub nonce: String,
    /// The username attempting authentication.
    pub username: String,
}

/// Initiate SSH pubkey authentication: check if the key is authorized and generate a challenge.
pub fn handle_pubkey_init(
    home_dir: &Path,
    username: &str,
    pubkey: &str,
) -> Result<PubkeyChallenge, String> {
    let authorized_keys = read_authorized_keys(home_dir)?;

    // Check if the provided public key matches any authorized key
    if !authorized_keys.iter().any(|k| k == pubkey) {
        return Err("Public key not authorized".to_string());
    }

    let nonce = generate_nonce();
    Ok(PubkeyChallenge {
        pubkey: pubkey.to_string(),
        nonce,
        username: username.to_string(),
    })
}

/// Verify the client's signature over the challenge nonce.
/// Returns Ok(()) if the signature is valid for the public key.
pub fn verify_pubkey_signature(
    challenge: &PubkeyChallenge,
    signature_b64: &str,
) -> Result<(), String> {
    use base64::Engine;
    use ssh_key::PublicKey;

    // Decode the nonce (the data that was signed)
    let nonce_bytes = base64::engine::general_purpose::STANDARD
        .decode(&challenge.nonce)
        .map_err(|e| format!("Invalid nonce encoding: {}", e))?;

    // Decode the signature
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_b64)
        .map_err(|e| format!("Invalid signature encoding: {}", e))?;

    // Parse the SSH public key
    let pubkey = PublicKey::from_openssh(&challenge.pubkey)
        .map_err(|e| format!("Invalid public key: {}", e))?;

    // Verify signature based on key type
    verify_signature_for_key(&pubkey, &nonce_bytes, &signature_bytes)
}

/// Verify a raw signature against an SSH public key using ring.
fn verify_signature_for_key(
    pubkey: &ssh_key::PublicKey,
    message: &[u8],
    signature: &[u8],
) -> Result<(), String> {
    use ssh_key::public::KeyData;

    match pubkey.key_data() {
        KeyData::Ed25519(key) => {
            let key_bytes = key.as_ref();
            let peer_public_key = ring::signature::UnparsedPublicKey::new(
                &ring::signature::ED25519,
                key_bytes,
            );
            peer_public_key.verify(message, signature)
                .map_err(|_| "Ed25519 signature verification failed".to_string())
        }
        KeyData::Rsa(key) => {
            // RSA public key in SSH format: e + n
            // ring needs the key in DER SubjectPublicKeyInfo format
            // Build the DER encoding manually
            let rsa_der = build_rsa_spki_der(key.e.as_ref(), key.n.as_ref());
            let peer_public_key = ring::signature::UnparsedPublicKey::new(
                &ring::signature::RSA_PKCS1_2048_8192_SHA256,
                &rsa_der,
            );
            peer_public_key.verify(message, signature)
                .map_err(|_| "RSA signature verification failed".to_string())
        }
        KeyData::Ecdsa(key) => {
            use ssh_key::EcdsaCurve;
            match key.curve() {
                EcdsaCurve::NistP256 => {
                    let point_bytes = key.as_ref();
                    let peer_public_key = ring::signature::UnparsedPublicKey::new(
                        &ring::signature::ECDSA_P256_SHA256_ASN1,
                        point_bytes,
                    );
                    peer_public_key.verify(message, signature)
                        .map_err(|_| "ECDSA-P256 signature verification failed".to_string())
                }
                other => Err(format!("Unsupported ECDSA curve: {:?}", other)),
            }
        }
        _ => Err("Unsupported key type".to_string()),
    }
}

/// Build RSA SubjectPublicKeyInfo DER encoding from raw e and n.
fn build_rsa_spki_der(e: &[u8], n: &[u8]) -> Vec<u8> {
    // ASN.1 DER encoding for RSA SPKI:
    // SEQUENCE {
    //   SEQUENCE { OID rsaEncryption, NULL }
    //   BIT STRING { SEQUENCE { INTEGER n, INTEGER e } }
    // }
    let rsa_oid: &[u8] = &[0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

    fn encode_integer(value: &[u8]) -> Vec<u8> {
        let mut result = Vec::new();
        // If high bit set, prepend 0x00
        let needs_pad = !value.is_empty() && (value[0] & 0x80) != 0;
        let len = value.len() + if needs_pad { 1 } else { 0 };
        result.push(0x02); // INTEGER tag
        encode_length(len, &mut result);
        if needs_pad {
            result.push(0x00);
        }
        result.extend_from_slice(value);
        result
    }

    fn encode_length(len: usize, out: &mut Vec<u8>) {
        if len < 128 {
            out.push(len as u8);
        } else if len < 256 {
            out.push(0x81);
            out.push(len as u8);
        } else {
            out.push(0x82);
            out.push((len >> 8) as u8);
            out.push((len & 0xff) as u8);
        }
    }

    fn encode_sequence(content: &[u8]) -> Vec<u8> {
        let mut result = Vec::new();
        result.push(0x30); // SEQUENCE tag
        encode_length(content.len(), &mut result);
        result.extend_from_slice(content);
        result
    }

    // Inner: SEQUENCE { INTEGER n, INTEGER e }
    let n_enc = encode_integer(n);
    let e_enc = encode_integer(e);
    let mut inner_seq_content = Vec::new();
    inner_seq_content.extend_from_slice(&n_enc);
    inner_seq_content.extend_from_slice(&e_enc);
    let inner_seq = encode_sequence(&inner_seq_content);

    // BIT STRING wrapping the inner sequence
    let mut bit_string = Vec::new();
    bit_string.push(0x03); // BIT STRING tag
    encode_length(inner_seq.len() + 1, &mut bit_string);
    bit_string.push(0x00); // no unused bits
    bit_string.extend_from_slice(&inner_seq);

    // Algorithm identifier: SEQUENCE { OID, NULL }
    let algo_seq = encode_sequence(rsa_oid);

    // Outer SEQUENCE { algo, bitstring }
    let mut outer_content = Vec::new();
    outer_content.extend_from_slice(&algo_seq);
    outer_content.extend_from_slice(&bit_string);
    encode_sequence(&outer_content)
}

/// Complete the SSH pubkey auth flow: verify signature and issue JWT.
pub fn handle_pubkey_verify(
    challenge: &PubkeyChallenge,
    signing_key: &[u8],
    server_id: &str,
    signature_b64: &str,
    token_expiry: Duration,
) -> Result<AuthResult, String> {
    verify_pubkey_signature(challenge, signature_b64)?;

    let token = jwt::issue_token(signing_key, &challenge.username, server_id, token_expiry)
        .map_err(|e| format!("Failed to issue token: {}", e))?;

    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs() + token_expiry.as_secs();

    let expires = format_unix_timestamp(expires_at);
    Ok(AuthResult { token, expires })
}

fn format_unix_timestamp(ts: u64) -> String {
    // Simple ISO 8601 format without chrono dependency
    let secs = ts;
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Days since epoch to date (simplified - good enough for token display)
    let mut y = 1970i64;
    let mut remaining_days = days as i64;

    loop {
        let year_days = if is_leap_year(y) { 366 } else { 365 };
        if remaining_days < year_days {
            break;
        }
        remaining_days -= year_days;
        y += 1;
    }

    let month_days = if is_leap_year(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut m = 0;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining_days < md {
            m = i;
            break;
        }
        remaining_days -= md;
    }

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m + 1, remaining_days + 1, hours, minutes, seconds)
}

fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mock password verifier for tests.
    struct MockVerifier {
        valid_username: String,
        valid_password: String,
    }

    impl MockVerifier {
        fn new(username: &str, password: &str) -> Self {
            Self {
                valid_username: username.to_string(),
                valid_password: password.to_string(),
            }
        }
    }

    impl PasswordVerifier for MockVerifier {
        fn verify(&self, username: &str, password: &str) -> Result<(), String> {
            if username == self.valid_username && password == self.valid_password {
                Ok(())
            } else {
                Err("Invalid username or password".to_string())
            }
        }
    }

    #[test]
    fn test_password_auth_success() {
        let verifier = MockVerifier::new("narayan", "correct-password");
        let key = jwt::generate_signing_key();
        let result = handle_password_auth(
            &verifier, &key, "server-1", "narayan", "correct-password",
            Duration::from_secs(86400),
        );
        assert!(result.is_ok());
        let auth = result.unwrap();
        assert_eq!(auth.token.split('.').count(), 3, "Should be valid JWT");
        assert!(auth.expires.contains("T"), "Expires should be ISO 8601");
    }

    #[test]
    fn test_password_auth_wrong_password() {
        let verifier = MockVerifier::new("narayan", "correct-password");
        let key = jwt::generate_signing_key();
        let result = handle_password_auth(
            &verifier, &key, "server-1", "narayan", "wrong-password",
            Duration::from_secs(86400),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid"));
    }

    #[test]
    fn test_password_auth_wrong_username() {
        let verifier = MockVerifier::new("narayan", "password");
        let key = jwt::generate_signing_key();
        let result = handle_password_auth(
            &verifier, &key, "server-1", "unknown", "password",
            Duration::from_secs(86400),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_password_auth_jwt_is_valid() {
        let verifier = MockVerifier::new("narayan", "pass");
        let key = jwt::generate_signing_key();
        let result = handle_password_auth(
            &verifier, &key, "srv-1", "narayan", "pass",
            Duration::from_secs(3600),
        ).unwrap();

        // Validate the issued JWT
        let claims = jwt::validate_token(&key, &result.token).unwrap();
        assert_eq!(claims.sub, "narayan");
        assert_eq!(claims.server_id, "srv-1");
    }

    #[test]
    fn test_token_auth_valid_jwt() {
        let key = jwt::generate_signing_key();
        let token = jwt::issue_token(&key, "narayan", "srv-1", Duration::from_secs(86400)).unwrap();

        let result = handle_token_auth(&key, &token);
        assert!(result.is_ok());
        let auth = result.unwrap();
        assert_eq!(auth.token, token);
    }

    #[test]
    fn test_token_auth_invalid_jwt() {
        let key = jwt::generate_signing_key();
        let result = handle_token_auth(&key, "not.a.valid.jwt");
        assert!(result.is_err());
    }

    #[test]
    fn test_token_auth_expired_jwt() {
        let key = jwt::generate_signing_key();
        // Create a token that expired an hour ago
        let past = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() - 7200;
        let token = jwt::issue_token_for_test(&key, "narayan", "srv-1", past, Duration::from_secs(3600)).unwrap();

        let result = handle_token_auth(&key, &token);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Token validation failed"));
    }

    #[test]
    fn test_read_authorized_keys_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let keys = read_authorized_keys(dir.path()).unwrap();
        assert!(keys.is_empty());
    }

    #[test]
    fn test_read_authorized_keys_with_entries() {
        let dir = tempfile::tempdir().unwrap();
        let ssh_dir = dir.path().join(".ssh");
        std::fs::create_dir_all(&ssh_dir).unwrap();
        std::fs::write(ssh_dir.join("authorized_keys"),
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest user@host\n\
             # comment line\n\
             ssh-rsa AAAAB3NzaC1yc2EAAAADAQABATest another@host\n\
             \n"
        ).unwrap();

        let keys = read_authorized_keys(dir.path()).unwrap();
        assert_eq!(keys.len(), 2);
        assert!(keys[0].starts_with("ssh-ed25519 "));
        assert!(keys[1].starts_with("ssh-rsa "));
        // Comments should be stripped
        assert!(!keys[0].contains("user@host"));
    }

    #[test]
    fn test_generate_nonce_is_base64() {
        let nonce = generate_nonce();
        assert!(!nonce.is_empty());
        // Base64 of 32 bytes = 44 chars
        assert_eq!(nonce.len(), 44);
        // Should be different each time
        let nonce2 = generate_nonce();
        assert_ne!(nonce, nonce2);
    }

    #[test]
    fn test_pubkey_init_authorized_key() {
        let dir = tempfile::tempdir().unwrap();
        let ssh_dir = dir.path().join(".ssh");
        std::fs::create_dir_all(&ssh_dir).unwrap();
        std::fs::write(ssh_dir.join("authorized_keys"),
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest user@test\n"
        ).unwrap();

        let result = handle_pubkey_init(dir.path(), "narayan", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest");
        assert!(result.is_ok());
        let challenge = result.unwrap();
        assert_eq!(challenge.username, "narayan");
        assert_eq!(challenge.pubkey, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest");
        assert!(!challenge.nonce.is_empty());
    }

    #[test]
    fn test_pubkey_init_unauthorized_key() {
        let dir = tempfile::tempdir().unwrap();
        let ssh_dir = dir.path().join(".ssh");
        std::fs::create_dir_all(&ssh_dir).unwrap();
        std::fs::write(ssh_dir.join("authorized_keys"),
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest user@test\n"
        ).unwrap();

        let result = handle_pubkey_init(dir.path(), "narayan", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGother");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not authorized"));
    }

    #[test]
    fn test_pubkey_init_no_authorized_keys_file() {
        let dir = tempfile::tempdir().unwrap();
        let result = handle_pubkey_init(dir.path(), "narayan", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not authorized"));
    }

    #[test]
    fn test_verify_ed25519_signature() {
        use base64::Engine;
        use ed25519_dalek::{SigningKey, Signer};

        // Generate an ed25519 keypair
        let mut rng_bytes = [0u8; 32];
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut rng_bytes).unwrap();
        let signing_key = SigningKey::from_bytes(&rng_bytes);
        let verifying_key = signing_key.verifying_key();

        // Build the OpenSSH public key string
        let pubkey_bytes = verifying_key.to_bytes();
        let mut ssh_blob = Vec::new();
        // SSH wire format: u32 len + "ssh-ed25519" + u32 len + key bytes
        let algo = b"ssh-ed25519";
        ssh_blob.extend_from_slice(&(algo.len() as u32).to_be_bytes());
        ssh_blob.extend_from_slice(algo);
        ssh_blob.extend_from_slice(&(pubkey_bytes.len() as u32).to_be_bytes());
        ssh_blob.extend_from_slice(&pubkey_bytes);
        let pubkey_str = format!("ssh-ed25519 {}", base64::engine::general_purpose::STANDARD.encode(&ssh_blob));

        // Create a challenge
        let nonce = generate_nonce();
        let nonce_bytes = base64::engine::general_purpose::STANDARD.decode(&nonce).unwrap();

        // Sign the nonce
        let sig = signing_key.sign(&nonce_bytes);
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());

        let challenge = PubkeyChallenge {
            pubkey: pubkey_str,
            nonce,
            username: "narayan".to_string(),
        };

        let result = verify_pubkey_signature(&challenge, &sig_b64);
        assert!(result.is_ok(), "Ed25519 signature should verify: {:?}", result);
    }

    #[test]
    fn test_verify_ed25519_wrong_signature() {
        use base64::Engine;

        // Use a valid-looking but wrong signature
        let challenge = PubkeyChallenge {
            pubkey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest".to_string(),
            nonce: base64::engine::general_purpose::STANDARD.encode(&[1u8; 32]),
            username: "narayan".to_string(),
        };

        let bad_sig = base64::engine::general_purpose::STANDARD.encode(&[0u8; 64]);
        let result = verify_pubkey_signature(&challenge, &bad_sig);
        assert!(result.is_err());
    }

    #[test]
    fn test_handle_pubkey_verify_issues_jwt() {
        use base64::Engine;
        use ed25519_dalek::{SigningKey, Signer};

        // Generate keypair
        let mut rng_bytes = [0u8; 32];
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut rng_bytes).unwrap();
        let signing_key_ed = SigningKey::from_bytes(&rng_bytes);
        let verifying_key = signing_key_ed.verifying_key();

        // Build OpenSSH pubkey
        let pubkey_bytes = verifying_key.to_bytes();
        let mut ssh_blob = Vec::new();
        let algo = b"ssh-ed25519";
        ssh_blob.extend_from_slice(&(algo.len() as u32).to_be_bytes());
        ssh_blob.extend_from_slice(algo);
        ssh_blob.extend_from_slice(&(pubkey_bytes.len() as u32).to_be_bytes());
        ssh_blob.extend_from_slice(&pubkey_bytes);
        let pubkey_str = format!("ssh-ed25519 {}", base64::engine::general_purpose::STANDARD.encode(&ssh_blob));

        let nonce = generate_nonce();
        let nonce_bytes = base64::engine::general_purpose::STANDARD.decode(&nonce).unwrap();
        let sig = signing_key_ed.sign(&nonce_bytes);
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());

        let challenge = PubkeyChallenge {
            pubkey: pubkey_str,
            nonce,
            username: "narayan".to_string(),
        };

        let jwt_key = jwt::generate_signing_key();
        let result = handle_pubkey_verify(
            &challenge, &jwt_key, "srv-1", &sig_b64, Duration::from_secs(3600),
        );
        assert!(result.is_ok(), "Should issue JWT: {:?}", result);
        let auth = result.unwrap();
        assert_eq!(auth.token.split('.').count(), 3);

        // Verify the JWT claims
        let claims = jwt::validate_token(&jwt_key, &auth.token).unwrap();
        assert_eq!(claims.sub, "narayan");
        assert_eq!(claims.server_id, "srv-1");
    }

    #[test]
    fn test_create_platform_verifier_returns_verifier() {
        // On any platform, create_platform_verifier should return a verifier
        let verifier = create_platform_verifier("login");
        assert!(verifier.is_some(), "Platform verifier should be available on this OS");
    }

    #[test]
    fn test_format_unix_timestamp() {
        // 2026-01-29T00:00:00Z = 1769472000 (approximately)
        let ts = format_unix_timestamp(0);
        assert_eq!(ts, "1970-01-01T00:00:00Z");

        let ts2 = format_unix_timestamp(86400);
        assert_eq!(ts2, "1970-01-02T00:00:00Z");
    }
}
