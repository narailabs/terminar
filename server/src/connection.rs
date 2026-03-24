//! WebSocket connection health monitoring.
//!
//! Tracks ping/pong state for WebSocket connections to detect stale connections.
//! Sends pings every PING_INTERVAL seconds and closes connections that don't
//! respond within PONG_TIMEOUT seconds.

use std::time::{Duration, Instant};

// Re-export from constants for backward compatibility
pub use crate::constants::{PING_INTERVAL, PONG_TIMEOUT};

/// Tracks the health state of a WebSocket connection.
#[derive(Debug)]
pub struct ConnectionHealth {
    /// When the last ping was sent
    last_ping_sent: Option<Instant>,
    /// When the last pong was received
    last_pong_received: Option<Instant>,
    /// When the connection was established
    connected_at: Instant,
    /// Latest measured round-trip latency
    latency: Option<Duration>,
}

impl Default for ConnectionHealth {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionHealth {
    /// Create a new connection health tracker.
    pub fn new() -> Self {
        Self {
            last_ping_sent: None,
            last_pong_received: None,
            connected_at: Instant::now(),
            latency: None,
        }
    }

    /// Create with a specific connection time (for testing).
    pub fn new_at(connected_at: Instant) -> Self {
        Self {
            last_ping_sent: None,
            last_pong_received: None,
            connected_at,
            latency: None,
        }
    }

    /// Record that a ping was sent at the given time.
    pub fn record_ping_sent(&mut self, at: Instant) {
        self.last_ping_sent = Some(at);
    }

    /// Record that a pong was received at the given time.
    /// Updates latency if a corresponding ping was sent.
    pub fn record_pong_received(&mut self, at: Instant) {
        if let Some(ping_time) = self.last_ping_sent {
            self.latency = Some(at.duration_since(ping_time));
        }
        self.last_pong_received = Some(at);
    }

    /// Check if a ping should be sent now.
    /// Returns true if enough time has elapsed since the last ping (or connection start).
    pub fn should_send_ping(&self, now: Instant) -> bool {
        let reference = self.last_ping_sent.unwrap_or(self.connected_at);
        now.duration_since(reference) >= PING_INTERVAL
    }

    /// Check if the connection is stale (no pong received within timeout).
    /// A connection is stale if a ping was sent and no pong was received within PONG_TIMEOUT.
    pub fn is_stale(&self, now: Instant) -> bool {
        if let Some(ping_time) = self.last_ping_sent {
            // If we got a pong after the last ping, not stale
            if let Some(pong_time) = self.last_pong_received
                && pong_time >= ping_time
            {
                return false;
            }
            // No pong after last ping - check timeout
            now.duration_since(ping_time) >= PONG_TIMEOUT
        } else {
            false // No ping sent yet, can't be stale
        }
    }

    /// Get the latest measured round-trip latency.
    pub fn latency(&self) -> Option<Duration> {
        self.latency
    }

    /// Get the connection uptime.
    pub fn uptime(&self, now: Instant) -> Duration {
        now.duration_since(self.connected_at)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_connection_health() {
        let health = ConnectionHealth::new();
        assert!(
            health.latency().is_none(),
            "New connection should have no latency"
        );
        assert!(
            !health.is_stale(Instant::now()),
            "New connection should not be stale"
        );
    }

    #[test]
    fn test_should_send_ping_after_interval() {
        let start = Instant::now();
        let health = ConnectionHealth::new_at(start);

        // Immediately after creation, should not send ping
        assert!(
            !health.should_send_ping(start),
            "Should not ping immediately after creation"
        );

        // After PING_INTERVAL, should send ping
        let after_interval = start + PING_INTERVAL;
        assert!(
            health.should_send_ping(after_interval),
            "Should send ping after interval elapsed"
        );
    }

    #[test]
    fn test_should_send_ping_resets_after_ping() {
        let start = Instant::now();
        let mut health = ConnectionHealth::new_at(start);

        // Send a ping
        let ping_time = start + PING_INTERVAL;
        health.record_ping_sent(ping_time);

        // Right after ping, should not send another
        assert!(
            !health.should_send_ping(ping_time + Duration::from_secs(1)),
            "Should not ping right after sending one"
        );

        // After another interval, should send again
        assert!(
            health.should_send_ping(ping_time + PING_INTERVAL),
            "Should send ping after another interval"
        );
    }

    #[test]
    fn test_is_stale_no_ping_sent() {
        let health = ConnectionHealth::new();
        let far_future = Instant::now() + Duration::from_secs(300);
        assert!(
            !health.is_stale(far_future),
            "Cannot be stale if no ping was ever sent"
        );
    }

    #[test]
    fn test_is_stale_pong_received_in_time() {
        let start = Instant::now();
        let mut health = ConnectionHealth::new_at(start);

        // Send ping
        let ping_time = start + PING_INTERVAL;
        health.record_ping_sent(ping_time);

        // Receive pong within timeout
        let pong_time = ping_time + Duration::from_secs(1);
        health.record_pong_received(pong_time);

        // Even after PONG_TIMEOUT, not stale because pong was received
        let check_time = ping_time + PONG_TIMEOUT + Duration::from_secs(1);
        assert!(
            !health.is_stale(check_time),
            "Should not be stale if pong was received after ping"
        );
    }

    #[test]
    fn test_is_stale_no_pong_after_timeout() {
        let start = Instant::now();
        let mut health = ConnectionHealth::new_at(start);

        // Send ping
        let ping_time = start + PING_INTERVAL;
        health.record_ping_sent(ping_time);

        // No pong received, check after timeout
        let after_timeout = ping_time + PONG_TIMEOUT;
        assert!(
            health.is_stale(after_timeout),
            "Should be stale if no pong received within timeout"
        );
    }

    #[test]
    fn test_is_stale_pong_from_previous_ping() {
        let start = Instant::now();
        let mut health = ConnectionHealth::new_at(start);

        // First ping-pong cycle
        let ping1 = start + PING_INTERVAL;
        health.record_ping_sent(ping1);
        health.record_pong_received(ping1 + Duration::from_secs(1));

        // Second ping, no pong
        let ping2 = ping1 + PING_INTERVAL;
        health.record_ping_sent(ping2);

        // The pong from ping1 was before ping2, so connection should be stale after timeout
        let after_timeout = ping2 + PONG_TIMEOUT;
        assert!(
            health.is_stale(after_timeout),
            "Should be stale: pong was from previous ping, not the latest"
        );
    }

    #[test]
    fn test_latency_calculated_on_pong() {
        let start = Instant::now();
        let mut health = ConnectionHealth::new_at(start);

        // Send ping
        let ping_time = start + PING_INTERVAL;
        health.record_ping_sent(ping_time);

        // Receive pong 50ms later
        let pong_time = ping_time + Duration::from_millis(50);
        health.record_pong_received(pong_time);

        let latency = health.latency().expect("Should have latency after pong");
        assert_eq!(
            latency,
            Duration::from_millis(50),
            "Latency should be time between ping and pong"
        );
    }

    #[test]
    fn test_latency_none_without_ping() {
        let mut health = ConnectionHealth::new();
        // Pong without ping should not compute latency
        health.record_pong_received(Instant::now());
        // Actually, record_pong_received only sets latency if last_ping_sent is Some
        // Since no ping was sent, latency should remain None
        assert!(
            health.latency().is_none(),
            "Latency should be None if pong received without prior ping"
        );
    }

    #[test]
    fn test_uptime() {
        let start = Instant::now();
        let health = ConnectionHealth::new_at(start);
        let later = start + Duration::from_secs(120);
        assert_eq!(health.uptime(later), Duration::from_secs(120));
    }

    #[test]
    fn test_ping_interval_is_30_seconds() {
        assert_eq!(PING_INTERVAL, Duration::from_secs(30));
    }

    #[test]
    fn test_pong_timeout_is_60_seconds() {
        assert_eq!(PONG_TIMEOUT, Duration::from_secs(60));
    }
}
