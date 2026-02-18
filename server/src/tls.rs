//! TLS configuration and server setup for the terminar server.
//!
//! Provides optional TLS support using `rustls` and `axum-server`. When a TLS
//! certificate and key are provided via CLI flags, an additional HTTPS/WSS
//! listener is started alongside the existing HTTP/WS listener.

use std::path::Path;

use axum::Router;
use ring::digest;
use rustls::ServerConfig;
use tracing::info;

/// TLS configuration parsed and validated from CLI flags.
#[derive(Debug, Clone)]
pub struct TlsConfig {
    pub cert_path: String,
    pub key_path: String,
    pub port: u16,
}

/// Errors that can occur during TLS configuration.
#[derive(Debug, thiserror::Error)]
pub enum TlsError {
    #[error("--tls-cert was provided but --tls-key is missing")]
    MissingKey,

    #[error("--tls-key was provided but --tls-cert is missing")]
    MissingCert,

    #[error("TLS certificate file not found: {0}")]
    CertNotFound(String),

    #[error("TLS key file not found: {0}")]
    KeyNotFound(String),

    #[error("Failed to read TLS certificate file: {0}")]
    CertReadError(String),

    #[error("Failed to read TLS key file: {0}")]
    KeyReadError(String),

    #[error("No valid TLS certificates found in {0}")]
    NoCertsFound(String),

    #[error("No valid TLS private key found in {0}")]
    NoKeyFound(String),

    #[error("Failed to build TLS configuration: {0}")]
    ConfigError(String),
}

/// Validates CLI flags and returns a `TlsConfig` if TLS is requested.
///
/// Returns `Ok(None)` if neither `--tls-cert` nor `--tls-key` is provided.
/// Returns `Err` if only one of cert/key is provided, or if the files don't exist.
pub fn validate_tls_config(
    tls_cert: &Option<String>,
    tls_key: &Option<String>,
    tls_port: u16,
) -> Result<Option<TlsConfig>, TlsError> {
    match (tls_cert, tls_key) {
        (None, None) => Ok(None),
        (Some(_), None) => Err(TlsError::MissingKey),
        (None, Some(_)) => Err(TlsError::MissingCert),
        (Some(cert), Some(key)) => {
            if !Path::new(cert).exists() {
                return Err(TlsError::CertNotFound(cert.clone()));
            }
            if !Path::new(key).exists() {
                return Err(TlsError::KeyNotFound(key.clone()));
            }
            Ok(Some(TlsConfig {
                cert_path: cert.clone(),
                key_path: key.clone(),
                port: tls_port,
            }))
        }
    }
}

/// Loads a rustls `ServerConfig` from PEM certificate and key files.
pub fn load_rustls_config(config: &TlsConfig) -> Result<ServerConfig, TlsError> {
    use rustls_pemfile::{certs, pkcs8_private_keys};
    use std::io::BufReader;

    let cert_file = std::fs::File::open(&config.cert_path)
        .map_err(|e| TlsError::CertReadError(format!("{}: {}", config.cert_path, e)))?;
    let key_file = std::fs::File::open(&config.key_path)
        .map_err(|e| TlsError::KeyReadError(format!("{}: {}", config.key_path, e)))?;

    let certs: Vec<rustls::pki_types::CertificateDer<'static>> =
        certs(&mut BufReader::new(cert_file))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| TlsError::CertReadError(format!("{}: {}", config.cert_path, e)))?;

    if certs.is_empty() {
        return Err(TlsError::NoCertsFound(config.cert_path.clone()));
    }

    let keys: Vec<rustls::pki_types::PrivatePkcs8KeyDer<'static>> =
        pkcs8_private_keys(&mut BufReader::new(key_file))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| TlsError::KeyReadError(format!("{}: {}", config.key_path, e)))?;

    let key = keys
        .into_iter()
        .next()
        .ok_or_else(|| TlsError::NoKeyFound(config.key_path.clone()))?;

    let server_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, rustls::pki_types::PrivateKeyDer::Pkcs8(key))
        .map_err(|e| TlsError::ConfigError(e.to_string()))?;

    Ok(server_config)
}

/// Result of generating or loading a TLS certificate.
#[derive(Debug, Clone)]
pub struct GeneratedCert {
    pub cert_path: String,
    pub key_path: String,
    pub fingerprint: String,
}

/// Generates a self-signed TLS certificate and key, writing them to `tls_dir`.
///
/// Creates the directory if it doesn't exist. Uses ECDSA P-256 for the key.
/// Returns paths to the cert/key files and the SHA-256 fingerprint.
pub fn generate_self_signed_cert(tls_dir: &Path) -> Result<GeneratedCert, TlsError> {
    use rcgen::{CertificateParams, KeyPair};
    use std::fs;

    // Create directory
    fs::create_dir_all(tls_dir)
        .map_err(|e| TlsError::ConfigError(format!("Failed to create TLS directory: {}", e)))?;

    let cert_path = tls_dir.join("cert.pem");
    let key_path = tls_dir.join("key.pem");

    // Generate certificate
    let mut params = CertificateParams::new(vec!["localhost".to_string()])
        .map_err(|e| TlsError::ConfigError(format!("Failed to create cert params: {}", e)))?;
    params.distinguished_name.push(
        rcgen::DnType::CommonName,
        rcgen::DnValue::Utf8String("Persistent Shell Server".to_string()),
    );

    let key_pair = KeyPair::generate()
        .map_err(|e| TlsError::ConfigError(format!("Failed to generate key pair: {}", e)))?;

    let cert = params.self_signed(&key_pair)
        .map_err(|e| TlsError::ConfigError(format!("Failed to generate self-signed cert: {}", e)))?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    fs::write(&cert_path, &cert_pem)
        .map_err(|e| TlsError::ConfigError(format!("Failed to write cert: {}", e)))?;
    fs::write(&key_path, &key_pem)
        .map_err(|e| TlsError::ConfigError(format!("Failed to write key: {}", e)))?;

    let fingerprint = compute_cert_fingerprint(cert_pem.as_bytes())
        .map_err(|e| TlsError::ConfigError(format!("Failed to compute fingerprint: {}", e)))?;

    Ok(GeneratedCert {
        cert_path: cert_path.to_str().unwrap().to_string(),
        key_path: key_path.to_str().unwrap().to_string(),
        fingerprint,
    })
}

/// Computes the SHA-256 fingerprint of a PEM-encoded certificate.
///
/// Returns a colon-separated hex string like `AB:CD:EF:...`.
pub fn compute_cert_fingerprint(pem_bytes: &[u8]) -> Result<String, String> {
    use rustls_pemfile::certs;
    use std::io::BufReader;

    let mut reader = BufReader::new(pem_bytes);
    let certs: Vec<_> = certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse PEM: {}", e))?;

    let cert_der = certs.into_iter().next()
        .ok_or_else(|| "No certificate found in PEM data".to_string())?;

    let hash = digest::digest(&digest::SHA256, cert_der.as_ref());
    let hex: Vec<String> = hash.as_ref().iter().map(|b| format!("{:02X}", b)).collect();
    Ok(hex.join(":"))
}

/// Ensures a TLS certificate exists in `tls_dir`.
///
/// If cert.pem and key.pem already exist, loads and returns their info.
/// Otherwise, generates a new self-signed certificate.
pub fn ensure_tls_cert(tls_dir: &Path) -> Result<GeneratedCert, TlsError> {
    let cert_path = tls_dir.join("cert.pem");
    let key_path = tls_dir.join("key.pem");

    if cert_path.exists() && key_path.exists() {
        // Load existing
        let cert_pem = std::fs::read(&cert_path)
            .map_err(|e| TlsError::CertReadError(format!("{}", e)))?;
        let fingerprint = compute_cert_fingerprint(&cert_pem)
            .map_err(TlsError::ConfigError)?;

        return Ok(GeneratedCert {
            cert_path: cert_path.to_str().unwrap().to_string(),
            key_path: key_path.to_str().unwrap().to_string(),
            fingerprint,
        });
    }

    generate_self_signed_cert(tls_dir)
}

/// Resolves TLS configuration from CLI flags.
///
/// Priority: explicit --tls-cert/--tls-key > --auto-tls > none.
/// When `auto_tls` is true and no explicit cert/key is provided, generates or
/// loads a self-signed certificate from `tls_dir`.
pub fn resolve_tls_config(
    tls_cert: Option<&str>,
    tls_key: Option<&str>,
    tls_port: u16,
    auto_tls: bool,
    tls_dir: &Path,
) -> Result<Option<TlsConfig>, TlsError> {
    // If explicit cert/key provided, use validate_tls_config (existing)
    if tls_cert.is_some() || tls_key.is_some() {
        return validate_tls_config(
            &tls_cert.map(|s| s.to_string()),
            &tls_key.map(|s| s.to_string()),
            tls_port,
        );
    }
    // If auto-tls, generate/load cert
    if auto_tls {
        let generated = ensure_tls_cert(tls_dir)?;
        return Ok(Some(TlsConfig {
            cert_path: generated.cert_path,
            key_path: generated.key_path,
            port: tls_port,
        }));
    }
    Ok(None)
}

/// Spawns the TLS server task using `axum-server`, returning the `JoinHandle`.
///
/// The TLS server serves the same `Router` as the plain HTTP server.
pub fn spawn_tls_server(
    tls_config: &TlsConfig,
    app: Router,
    mut shutdown_rx: tokio::sync::broadcast::Receiver<()>,
) -> Result<tokio::task::JoinHandle<()>, TlsError> {
    let rustls_config = load_rustls_config(tls_config)?;

    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", tls_config.port)
        .parse()
        .map_err(|e| TlsError::ConfigError(format!("Invalid TLS address: {}", e)))?;

    info!("TLS/HTTPS listener on https://{}", addr);

    let tls_server_config = axum_server::tls_rustls::RustlsConfig::from_config(
        std::sync::Arc::new(rustls_config),
    );

    let handle = axum_server::Handle::new();
    let server_handle = handle.clone();

    // Spawn a task to listen for shutdown and signal the axum-server handle
    tokio::spawn(async move {
        let _ = shutdown_rx.recv().await;
        server_handle.shutdown();
    });

    let task = tokio::spawn(async move {
        if let Err(e) = axum_server::bind_rustls(addr, tls_server_config)
            .handle(handle)
            .serve(app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await
        {
            tracing::error!("TLS server error: {}", e);
        }
    });

    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_validate_no_tls_returns_none() {
        let result = validate_tls_config(&None, &None, 8444);
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_validate_cert_without_key_errors() {
        let result = validate_tls_config(
            &Some("/path/to/cert.pem".to_string()),
            &None,
            8444,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TlsError::MissingKey));
        assert!(err.to_string().contains("--tls-key is missing"));
    }

    #[test]
    fn test_validate_key_without_cert_errors() {
        let result = validate_tls_config(
            &None,
            &Some("/path/to/key.pem".to_string()),
            8444,
        );
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), TlsError::MissingCert));
    }

    #[test]
    fn test_validate_cert_file_not_found() {
        let key_file = NamedTempFile::new().unwrap();
        let result = validate_tls_config(
            &Some("/nonexistent/cert.pem".to_string()),
            &Some(key_file.path().to_str().unwrap().to_string()),
            8444,
        );
        assert!(matches!(result.unwrap_err(), TlsError::CertNotFound(_)));
    }

    #[test]
    fn test_validate_key_file_not_found() {
        let cert_file = NamedTempFile::new().unwrap();
        let result = validate_tls_config(
            &Some(cert_file.path().to_str().unwrap().to_string()),
            &Some("/nonexistent/key.pem".to_string()),
            8444,
        );
        assert!(matches!(result.unwrap_err(), TlsError::KeyNotFound(_)));
    }

    #[test]
    fn test_validate_valid_files_returns_config() {
        let cert_file = NamedTempFile::new().unwrap();
        let key_file = NamedTempFile::new().unwrap();
        let result = validate_tls_config(
            &Some(cert_file.path().to_str().unwrap().to_string()),
            &Some(key_file.path().to_str().unwrap().to_string()),
            9443,
        );
        let config = result.unwrap().unwrap();
        assert_eq!(config.port, 9443);
        assert_eq!(config.cert_path, cert_file.path().to_str().unwrap());
        assert_eq!(config.key_path, key_file.path().to_str().unwrap());
    }

    #[test]
    fn test_load_rustls_config_empty_cert_file() {
        let cert_file = NamedTempFile::new().unwrap();
        let key_file = NamedTempFile::new().unwrap();
        let config = TlsConfig {
            cert_path: cert_file.path().to_str().unwrap().to_string(),
            key_path: key_file.path().to_str().unwrap().to_string(),
            port: 8444,
        };
        let result = load_rustls_config(&config);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), TlsError::NoCertsFound(_)));
    }

    #[test]
    fn test_load_rustls_config_invalid_cert_content() {
        let mut cert_file = NamedTempFile::new().unwrap();
        writeln!(cert_file, "not a valid certificate").unwrap();
        let key_file = NamedTempFile::new().unwrap();
        let config = TlsConfig {
            cert_path: cert_file.path().to_str().unwrap().to_string(),
            key_path: key_file.path().to_str().unwrap().to_string(),
            port: 8444,
        };
        let result = load_rustls_config(&config);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_rustls_config_valid_cert_no_key() {
        let mut cert_file = NamedTempFile::new().unwrap();
        // Structurally valid PEM block but key file is empty
        writeln!(cert_file, "-----BEGIN CERTIFICATE-----").unwrap();
        writeln!(cert_file, "MIIBkTCB+wIJALRiMLAh5WNHMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl").unwrap();
        writeln!(cert_file, "c3RDQTAYHBMDAQIBATADBGECAQAWMAEWMB4XDTI0MDEwMTAwMDAwMFoXDTI1MDEw").unwrap();
        writeln!(cert_file, "MTAwMDAwMFowETEPMA0GA1UEAwwGdGVzdENBMA0GCSqGSIb3DQEBCwUAA0EA").unwrap();
        writeln!(cert_file, "-----END CERTIFICATE-----").unwrap();

        let key_file = NamedTempFile::new().unwrap();
        let config = TlsConfig {
            cert_path: cert_file.path().to_str().unwrap().to_string(),
            key_path: key_file.path().to_str().unwrap().to_string(),
            port: 8444,
        };
        let result = load_rustls_config(&config);
        assert!(result.is_err());
    }

    #[test]
    fn test_generate_self_signed_cert_creates_files() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("tls");

        let result = generate_self_signed_cert(&tls_dir);
        assert!(result.is_ok(), "generate_self_signed_cert failed: {:?}", result.err());

        let gen = result.unwrap();
        assert!(Path::new(&gen.cert_path).exists(), "cert file not created");
        assert!(Path::new(&gen.key_path).exists(), "key file not created");
    }

    #[test]
    fn test_generate_self_signed_cert_creates_tls_directory() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("nested").join("tls");

        let result = generate_self_signed_cert(&tls_dir);
        assert!(result.is_ok());
        assert!(tls_dir.exists(), "tls directory not created");
    }

    #[test]
    fn test_generate_self_signed_cert_produces_valid_pem() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("tls");

        let gen = generate_self_signed_cert(&tls_dir).unwrap();

        // The generated files should be loadable by rustls
        let config = TlsConfig {
            cert_path: gen.cert_path,
            key_path: gen.key_path,
            port: 8444,
        };
        let result = load_rustls_config(&config);
        assert!(result.is_ok(), "Generated cert/key not loadable by rustls: {:?}", result.err());
    }

    #[test]
    fn test_generate_self_signed_cert_returns_fingerprint() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("tls");

        let gen = generate_self_signed_cert(&tls_dir).unwrap();
        // Fingerprint should be a hex-encoded SHA-256 hash (64 hex chars with colons)
        assert!(!gen.fingerprint.is_empty(), "fingerprint should not be empty");
        assert!(gen.fingerprint.contains(':'), "fingerprint should be colon-separated hex");
    }

    #[test]
    fn test_ensure_tls_cert_returns_existing_if_present() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("tls");

        // Generate first
        let gen1 = generate_self_signed_cert(&tls_dir).unwrap();

        // ensure_tls_cert should return the existing cert, not regenerate
        let gen2 = ensure_tls_cert(&tls_dir).unwrap();
        assert_eq!(gen1.cert_path, gen2.cert_path);
        assert_eq!(gen1.key_path, gen2.key_path);
        assert_eq!(gen1.fingerprint, gen2.fingerprint);
    }

    #[test]
    fn test_ensure_tls_cert_generates_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("tls");

        // No cert exists yet; ensure_tls_cert should generate one
        let result = ensure_tls_cert(&tls_dir);
        assert!(result.is_ok());
        let gen = result.unwrap();
        assert!(Path::new(&gen.cert_path).exists());
        assert!(Path::new(&gen.key_path).exists());
    }

    #[test]
    fn test_cert_fingerprint_computes_sha256() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("tls");

        let gen = generate_self_signed_cert(&tls_dir).unwrap();

        // Independently compute fingerprint from the cert file
        let cert_pem = std::fs::read(&gen.cert_path).unwrap();
        let computed = compute_cert_fingerprint(&cert_pem);
        assert!(computed.is_ok());
        assert_eq!(gen.fingerprint, computed.unwrap());
    }

    #[test]
    fn test_cert_fingerprint_format() {
        let dir = tempfile::tempdir().unwrap();
        let tls_dir = dir.path().join("tls");
        let gen = generate_self_signed_cert(&tls_dir).unwrap();
        let cert_bytes = std::fs::read(&gen.cert_path).unwrap();
        let fingerprint = compute_cert_fingerprint(&cert_bytes).unwrap();
        // SHA-256 fingerprint = 32 bytes = 64 hex chars + 31 colons = 95 chars
        assert_eq!(fingerprint.len(), 95);
        assert!(fingerprint.contains(':'));
    }

    #[test]
    fn test_resolve_tls_auto_generates_cert() {
        let tmp = tempfile::tempdir().unwrap();
        let tls_dir = tmp.path().join("tls");
        let result = resolve_tls_config(None, None, 8444, true, &tls_dir).unwrap();
        assert!(result.is_some());
        let config = result.unwrap();
        assert!(config.cert_path.ends_with("cert.pem"));
        assert!(config.key_path.ends_with("key.pem"));
        assert_eq!(config.port, 8444);
    }

    #[test]
    fn test_resolve_tls_no_flags_returns_none() {
        let tmp = tempfile::tempdir().unwrap();
        let tls_dir = tmp.path().join("tls");
        let result = resolve_tls_config(None, None, 8444, false, &tls_dir).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_tls_explicit_cert_takes_priority() {
        let tmp = tempfile::tempdir().unwrap();
        let tls_dir = tmp.path().join("tls");

        // Create explicit cert/key files
        let cert_file = NamedTempFile::new().unwrap();
        let key_file = NamedTempFile::new().unwrap();

        let result = resolve_tls_config(
            Some(cert_file.path().to_str().unwrap()),
            Some(key_file.path().to_str().unwrap()),
            9443,
            true, // auto_tls is true but should be ignored
            &tls_dir,
        ).unwrap();
        assert!(result.is_some());
        let config = result.unwrap();
        assert_eq!(config.cert_path, cert_file.path().to_str().unwrap());
        assert_eq!(config.key_path, key_file.path().to_str().unwrap());
        assert_eq!(config.port, 9443);
    }

    #[test]
    fn test_resolve_tls_explicit_cert_without_key_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let tls_dir = tmp.path().join("tls");
        let result = resolve_tls_config(
            Some("/path/to/cert.pem"),
            None,
            8444,
            true,
            &tls_dir,
        );
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), TlsError::MissingKey));
    }

    #[test]
    fn test_tls_error_display_messages() {
        assert_eq!(
            TlsError::MissingKey.to_string(),
            "--tls-cert was provided but --tls-key is missing"
        );
        assert_eq!(
            TlsError::MissingCert.to_string(),
            "--tls-key was provided but --tls-cert is missing"
        );
        assert_eq!(
            TlsError::CertNotFound("/foo/cert.pem".to_string()).to_string(),
            "TLS certificate file not found: /foo/cert.pem"
        );
        assert_eq!(
            TlsError::KeyNotFound("/foo/key.pem".to_string()).to_string(),
            "TLS key file not found: /foo/key.pem"
        );
    }
}
