//! Security response headers middleware.
//!
//! Adds standard security headers to all HTTP responses:
//! - `X-Content-Type-Options: nosniff`
//! - `X-Frame-Options: DENY`
//! - `Referrer-Policy: no-referrer`
//! - `Content-Security-Policy` with restrictive defaults
//! - `Strict-Transport-Security` (only when TLS is enabled)

use axum::{
    extract::State,
    http::{Request, HeaderValue},
    middleware::Next,
    response::Response,
};

/// Shared state for the security headers middleware.
#[derive(Clone)]
pub struct SecurityHeadersState {
    pub tls_enabled: bool,
}

/// Middleware that adds security headers to every response.
pub async fn security_headers_middleware(
    State(state): State<SecurityHeadersState>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    headers.insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));
    headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
    headers.insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "Content-Security-Policy",
        HeaderValue::from_static(
            "default-src 'self'; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'"
        ),
    );

    if state.tls_enabled {
        headers.insert(
            "Strict-Transport-Security",
            HeaderValue::from_static("max-age=31536000"),
        );
    }

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::get, Router, middleware};
    use tower::ServiceExt;

    fn test_app(tls_enabled: bool) -> Router {
        let state = SecurityHeadersState { tls_enabled };
        Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(
                state,
                security_headers_middleware,
            ))
    }

    #[tokio::test]
    async fn test_security_headers_added() {
        let app = test_app(false);

        let response = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response.headers().get("X-Content-Type-Options").unwrap(),
            "nosniff"
        );
        assert_eq!(
            response.headers().get("X-Frame-Options").unwrap(),
            "DENY"
        );
        assert_eq!(
            response.headers().get("Referrer-Policy").unwrap(),
            "no-referrer"
        );
        assert_eq!(
            response.headers().get("Content-Security-Policy").unwrap(),
            "default-src 'self'; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'"
        );
        // HSTS should NOT be set when tls_enabled=false
        assert!(response.headers().get("Strict-Transport-Security").is_none());
    }

    #[tokio::test]
    async fn test_hsts_when_tls_enabled() {
        let app = test_app(true);

        let response = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response.headers().get("Strict-Transport-Security").unwrap(),
            "max-age=31536000"
        );
    }

    #[tokio::test]
    async fn test_hsts_absent_when_tls_disabled() {
        let app = test_app(false);

        let response = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert!(response.headers().get("Strict-Transport-Security").is_none());
    }
}
