//! HttpOnly cookie helpers for browser-based authentication.
//!
//! After successful WebSocket auth, browsers call `POST /auth/session` to
//! receive HttpOnly cookies. On reconnection, the WebSocket upgrade request
//! carries cookies automatically — no localStorage token storage needed.

use axum::http::HeaderMap;

/// Build `Set-Cookie` header values for access and refresh tokens.
///
/// Returns a vec of (header-name, header-value) pairs. Both cookies are
/// `HttpOnly` and `SameSite=Strict`. The `Secure` flag is added when
/// `secure` is true (i.e., TLS is enabled).
pub fn set_auth_cookies(access_token: &str, refresh_token: &str, secure: bool) -> Vec<(String, String)> {
    let secure_flag = if secure { "; Secure" } else { "" };
    vec![
        ("Set-Cookie".to_string(), format!(
            "terminar_token={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900{}",
            access_token, secure_flag
        )),
        ("Set-Cookie".to_string(), format!(
            "terminar_refresh={}; HttpOnly; SameSite=Strict; Path=/auth/refresh; Max-Age=604800{}",
            refresh_token, secure_flag
        )),
    ]
}

/// Build `Set-Cookie` header values that clear auth cookies (Max-Age=0).
pub fn clear_auth_cookies() -> Vec<(String, String)> {
    vec![
        ("Set-Cookie".to_string(), "terminar_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0".to_string()),
        ("Set-Cookie".to_string(), "terminar_refresh=; HttpOnly; SameSite=Strict; Path=/auth/refresh; Max-Age=0".to_string()),
    ]
}

/// Extract a named cookie value from request headers.
///
/// Parses the `Cookie` header and returns the value of the first cookie
/// matching `name`, or `None` if not found.
pub fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get("Cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';')
                .map(|s| s.trim())
                .find(|s| s.starts_with(&format!("{}=", name)))
                .map(|s| s[name.len() + 1..].to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_set_auth_cookies_with_secure() {
        let cookies = set_auth_cookies("access123", "refresh456", true);
        assert_eq!(cookies.len(), 2);
        assert!(cookies[0].1.contains("terminar_token=access123"));
        assert!(cookies[0].1.contains("HttpOnly"));
        assert!(cookies[0].1.contains("Secure"));
        assert!(cookies[0].1.contains("SameSite=Strict"));
        assert!(cookies[0].1.contains("Max-Age=900"));
        assert!(cookies[0].1.contains("Path=/"));

        assert!(cookies[1].1.contains("terminar_refresh=refresh456"));
        assert!(cookies[1].1.contains("HttpOnly"));
        assert!(cookies[1].1.contains("Secure"));
        assert!(cookies[1].1.contains("Path=/auth/refresh"));
        assert!(cookies[1].1.contains("Max-Age=604800"));
    }

    #[test]
    fn test_set_auth_cookies_without_secure() {
        let cookies = set_auth_cookies("access123", "refresh456", false);
        assert!(!cookies[0].1.contains("Secure"));
        assert!(!cookies[1].1.contains("Secure"));
    }

    #[test]
    fn test_clear_auth_cookies() {
        let cookies = clear_auth_cookies();
        assert_eq!(cookies.len(), 2);
        assert!(cookies[0].1.contains("terminar_token=;"));
        assert!(cookies[0].1.contains("Max-Age=0"));
        assert!(cookies[1].1.contains("terminar_refresh=;"));
        assert!(cookies[1].1.contains("Max-Age=0"));
    }

    #[test]
    fn test_extract_cookie_found() {
        let mut headers = HeaderMap::new();
        headers.insert("Cookie", HeaderValue::from_static("terminar_token=abc123; other=xyz"));
        assert_eq!(extract_cookie(&headers, "terminar_token"), Some("abc123".to_string()));
    }

    #[test]
    fn test_extract_cookie_not_found() {
        let mut headers = HeaderMap::new();
        headers.insert("Cookie", HeaderValue::from_static("other=xyz"));
        assert_eq!(extract_cookie(&headers, "terminar_token"), None);
    }

    #[test]
    fn test_extract_cookie_no_cookie_header() {
        let headers = HeaderMap::new();
        assert_eq!(extract_cookie(&headers, "terminar_token"), None);
    }

    #[test]
    fn test_extract_cookie_multiple_cookies() {
        let mut headers = HeaderMap::new();
        headers.insert("Cookie", HeaderValue::from_static(
            "foo=bar; terminar_token=mytoken; terminar_refresh=myrefresh"
        ));
        assert_eq!(extract_cookie(&headers, "terminar_token"), Some("mytoken".to_string()));
        assert_eq!(extract_cookie(&headers, "terminar_refresh"), Some("myrefresh".to_string()));
    }

    #[test]
    fn test_extract_cookie_with_spaces() {
        let mut headers = HeaderMap::new();
        headers.insert("Cookie", HeaderValue::from_static("  terminar_token=abc123 ; other=xyz "));
        assert_eq!(extract_cookie(&headers, "terminar_token"), Some("abc123".to_string()));
    }
}
