use std::sync::Arc;
use std::io::Write;
use parking_lot::Mutex;  // Non-poisoning mutex - matches lib.rs
use std::collections::HashMap;
use tokio::sync::broadcast;
use tracing::debug;

use crate::history::CircularBuffer;

/// Type alias for synchronized PTY writer access.
/// The writer is taken once from the master and cached for the session lifetime.
pub type SyncWriter = Arc<Mutex<Box<dyn Write + Send>>>;

/// Represents the state of a terminal session
#[derive(Debug, Clone, PartialEq)]
pub enum SessionState {
    /// Session is being created (PTY being set up)
    Creating,
    /// Session is running and accepting input
    Running,
    /// Session is in the process of closing
    Closing,
    /// Session has been closed
    Closed,
    /// Session encountered an error
    Error,
}

impl SessionState {
    /// Check if a transition from the current state to the target state is valid.
    ///
    /// Valid transitions:
    /// - Creating -> Running (successful creation)
    /// - Creating -> Error (creation failed)
    /// - Running -> Closing (graceful shutdown initiated)
    /// - Running -> Error (runtime error)
    /// - Closing -> Closed (shutdown complete)
    /// - Closing -> Error (shutdown failed)
    ///
    /// Invalid transitions (terminal states cannot transition out):
    /// - Closed -> any
    /// - Error -> any
    /// - Any state -> Creating (cannot go back to initial state)
    /// - Closing -> Running (cannot resume from closing)
    pub fn can_transition_to(&self, target: &SessionState) -> bool {
        // Cannot transition to same state
        if self == target {
            return false;
        }

        match (self, target) {
            // Creating can transition to Running or Error
            (SessionState::Creating, SessionState::Running) => true,
            (SessionState::Creating, SessionState::Error) => true,

            // Running can transition to Closing or Error
            (SessionState::Running, SessionState::Closing) => true,
            (SessionState::Running, SessionState::Error) => true,

            // Closing can transition to Closed or Error
            (SessionState::Closing, SessionState::Closed) => true,
            (SessionState::Closing, SessionState::Error) => true,

            // All other transitions are invalid
            _ => false,
        }
    }

    /// Check if input operations are allowed in this state.
    /// Only Running state allows input.
    pub fn allows_input(&self) -> bool {
        matches!(self, SessionState::Running)
    }

    /// Check if resize operations are allowed in this state.
    /// Only Running state allows resize.
    pub fn allows_resize(&self) -> bool {
        matches!(self, SessionState::Running)
    }
}

#[derive(Clone, Debug)]
pub enum SessionEvent {
    Output(String),
    Closed,
}

/// Type alias for synchronized PTY master access.
///
/// # Lock Semantics
///
/// The Mutex provides synchronized access to the PTY master with the following semantics:
///
/// NOTE: We use Mutex instead of RwLock because `portable_pty::MasterPty` is `Send` but
/// not `Sync`. RwLock requires `T: Sync` for `RwLock<T>: Sync`, which is needed for
/// `Arc<RwLock<T>>: Send + Sync`. Since MasterPty is not Sync, we must use Mutex.
///
/// ## Exclusive Access (Mutex Lock)
/// All operations on the PTY master require exclusive access:
/// - `take_writer()` - Returns a writer that requires exclusive access to prevent
///   interleaved writes from multiple clients
/// - `resize()` - Modifies the terminal dimensions, requires exclusive access to
///   ensure consistent state
/// - `try_clone_reader()` - Cloning readers is safe, but still requires mutex due to
///   MasterPty not being Sync
/// - `get_size()` - Reading dimensions also requires mutex
///
/// ## Why Not RwLock?
/// The ideal design would use RwLock with:
/// - Write lock for `take_writer()` and `resize()` (exclusive operations)
/// - Read lock for `try_clone_reader()` and `get_size()` (shared operations)
///
/// However, `portable_pty::MasterPty` does not implement `Sync`, which means:
/// - `RwLock<Box<dyn MasterPty + Send>>` cannot be `Sync`
/// - `Arc<RwLock<...>>` cannot be `Send`
/// - This breaks async runtime requirements (tokio::spawn needs Send)
///
/// To use RwLock, the MasterPty trait would need to require Sync, or we would need
/// a wrapper type that provides interior mutability with Sync guarantees.
///
pub type SyncMasterPty = Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>;

pub struct Session {
    pub id: String,
    pub name: String,
    pub shell_cmd: String,
    /// The initial working directory for the session
    pub cwd: String,
    /// The current state of the session
    pub state: SessionState,
    /// The PTY master wrapped in Arc<Mutex<>> for synchronized concurrent access.
    /// See `SyncMasterPty` documentation for lock semantics and why Mutex is used
    /// instead of RwLock.
    pub master: SyncMasterPty,
    /// Cached PTY writer - taken once from master and reused for all input.
    /// This prevents the writer from being dropped after each input, which would
    /// close the PTY's stdin and cause the shell to exit.
    pub writer: SyncWriter,
    pub output_tx: broadcast::Sender<SessionEvent>,
    pub history: Arc<Mutex<CircularBuffer>>,
    /// Handle to the reader thread, used for cleanup
    pub reader_handle: Option<tokio::task::JoinHandle<()>>,
}

pub type SessionMap = Arc<Mutex<HashMap<String, Session>>>;

impl Session {
    /// Create a new session with the given PTY master.
    ///
    /// The master is automatically wrapped in `Arc<Mutex<>>` for synchronized
    /// concurrent access. See `SyncMasterPty` for lock semantics.
    ///
    /// The writer is taken from the master before wrapping and cached to prevent
    /// the PTY stdin from being closed after each input operation.
    ///
    /// The session state is set to `Running` after successful creation.
    ///
    /// # Panics
    /// Panics if `take_writer()` fails on the master.
    pub fn new(
        id: String,
        name: String,
        shell_cmd: String,
        cwd: String,
        master: Box<dyn portable_pty::MasterPty + Send>,
        output_tx: broadcast::Sender<SessionEvent>,
        history: Arc<Mutex<CircularBuffer>>,
    ) -> Self {
        // Take the writer before wrapping master to cache it for the session lifetime
        let writer = master.take_writer().expect("Failed to take writer from PTY master");
        Self {
            id,
            name,
            shell_cmd,
            cwd,
            state: SessionState::Running,
            master: Arc::new(Mutex::new(master)),
            writer: Arc::new(Mutex::new(writer)),
            output_tx,
            history,
            reader_handle: None,
        }
    }

    /// Attempt to transition the session to a new state.
    /// Returns Ok(()) if the transition is valid, Err with message if invalid.
    pub fn transition_to(&mut self, new_state: SessionState) -> Result<(), String> {
        if self.state.can_transition_to(&new_state) {
            self.state = new_state;
            Ok(())
        } else {
            Err(format!(
                "Invalid state transition from {:?} to {:?}",
                self.state, new_state
            ))
        }
    }

    /// Check if input operations are allowed in the current state.
    pub fn allows_input(&self) -> bool {
        self.state.allows_input()
    }

    /// Check if resize operations are allowed in the current state.
    pub fn allows_resize(&self) -> bool {
        self.state.allows_resize()
    }

    /// Set the reader thread handle after spawning
    pub fn set_reader_handle(&mut self, handle: tokio::task::JoinHandle<()>) {
        self.reader_handle = Some(handle);
    }

    /// Returns the number of active broadcast subscribers for this session.
    /// This is useful for monitoring and cleanup.
    pub fn subscriber_count(&self) -> usize {
        self.output_tx.receiver_count()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let subscriber_count = self.subscriber_count();
        debug!(
            "Dropping session {} (state: {:?}, subscribers: {})",
            self.id, self.state, subscriber_count
        );

        if subscriber_count > 0 {
            debug!(
                "Session {} has {} active broadcast subscriber(s) that will be disconnected",
                self.id, subscriber_count
            );
        }

        // Abort the reader thread if it's still running
        // This is safe because:
        // 1. The PTY master will be dropped after this, causing reads to fail
        // 2. Aborting prevents the thread from blocking indefinitely
        if let Some(handle) = self.reader_handle.take() {
            handle.abort();
        }

        // The broadcast::Sender (self.output_tx) will be dropped automatically,
        // which closes all subscriber channels and signals them to stop.
        // The PTY master (self.master) will be dropped automatically,
        // which closes the file descriptor and releases resources.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::MockPtyProvider;
    use crate::pty::PtyProvider;
    use portable_pty::PtySize;
    use std::thread;

    fn create_test_session() -> Session {
        let mock_provider = MockPtyProvider;
        let master = mock_provider.create_pty(80, 24).unwrap();
        let (tx, _rx) = broadcast::channel(100);
        let history = Arc::new(Mutex::new(crate::history::CircularBuffer::with_default_capacity()));

        Session::new(
            "test-id".to_string(),
            "test-session".to_string(),
            "/bin/bash".to_string(),
            "/home/user".to_string(),
            master,
            tx,
            history,
        )
    }

    /// Test that Session.master is wrapped in Arc<Mutex<>> for synchronized access.
    #[test]
    fn test_session_master_is_mutex_wrapped() {
        let session = create_test_session();

        // Verify we can acquire a lock on the master
        let guard = session.master.lock();

        // Verify we can call try_clone_reader through the lock
        let reader_result = guard.try_clone_reader();
        assert!(reader_result.is_ok(), "try_clone_reader should succeed through mutex lock");
    }

    /// Test that the cached writer can be used for input operations.
    #[test]
    fn test_cached_writer_through_mutex() {
        let session = create_test_session();

        // The writer is cached in session.writer - test we can lock and use it
        let mut writer_guard = session.writer.lock();
        use std::io::Write;
        let write_result = writer_guard.write_all(b"test input\n");
        assert!(write_result.is_ok(), "write_all should succeed through cached writer");
    }

    /// Test that resize operations work through the mutex.
    #[test]
    fn test_resize_through_mutex() {
        let session = create_test_session();

        // Mutex lock is required for resize
        let master_guard = session.master.lock();
        let resize_result = master_guard.resize(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        });
        assert!(resize_result.is_ok(), "resize should succeed through mutex lock");
    }

    /// Test that concurrent input and resize operations don't race.
    /// Operations are serialized by the mutex.
    #[test]
    fn test_concurrent_input_and_resize_are_serialized() {
        let session = Arc::new(create_test_session());

        // Spawn threads that perform input and resize operations
        let handles: Vec<_> = (0..10).map(|i| {
            let s = session.clone();
            thread::spawn(move || {
                if i % 2 == 0 {
                    // Resize operation - uses master lock
                    let master_guard = s.master.lock();
                    let _ = master_guard.resize(PtySize {
                        rows: 24 + (i as u16),
                        cols: 80,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                } else {
                    // Input operation - uses cached writer lock
                    let mut writer_guard = s.writer.lock();
                    use std::io::Write;
                    let _ = write!(writer_guard, "test{}", i);
                }
            })
        }).collect();

        // All threads should complete without deadlock or data race
        for handle in handles {
            handle.join().expect("Thread should complete successfully");
        }
    }

    /// Test that multiple reader cloning works through the mutex.
    #[test]
    fn test_reader_cloning_through_mutex() {
        let session = create_test_session();

        // Get mutex lock for reader cloning
        let master_lock = session.master.lock();

        // Multiple try_clone_reader calls should work
        let reader1 = master_lock.try_clone_reader();
        let reader2 = master_lock.try_clone_reader();

        assert!(reader1.is_ok(), "First reader clone should succeed");
        assert!(reader2.is_ok(), "Second reader clone should succeed");
    }

    /// Test that Arc allows sharing the master across threads.
    /// Each thread acquires and releases the lock before the next one tries.
    #[test]
    fn test_arc_allows_sharing_across_threads() {
        let session = create_test_session();
        let master = session.master.clone();  // Clone the Arc

        // First, use the master in the main thread
        {
            let guard = session.master.lock();
            let _ = guard.try_clone_reader();
        } // Lock is released here

        // Then spawn a thread that uses the cloned master
        let handle = thread::spawn(move || {
            let guard = master.lock();
            guard.try_clone_reader().is_ok()
        });

        // Thread should complete successfully
        let result = handle.join().expect("Thread should complete");
        assert!(result, "Thread should be able to clone reader");
    }

    // ==================== SessionState Tests ====================

    // Test: SessionState enum exists with required variants
    #[test]
    fn test_session_state_enum_has_creating_variant() {
        let state = SessionState::Creating;
        assert_eq!(state, SessionState::Creating);
    }

    #[test]
    fn test_session_state_enum_has_running_variant() {
        let state = SessionState::Running;
        assert_eq!(state, SessionState::Running);
    }

    #[test]
    fn test_session_state_enum_has_closing_variant() {
        let state = SessionState::Closing;
        assert_eq!(state, SessionState::Closing);
    }

    #[test]
    fn test_session_state_enum_has_closed_variant() {
        let state = SessionState::Closed;
        assert_eq!(state, SessionState::Closed);
    }

    #[test]
    fn test_session_state_enum_has_error_variant() {
        let state = SessionState::Error;
        assert_eq!(state, SessionState::Error);
    }

    #[test]
    fn test_session_state_implements_debug() {
        let state = SessionState::Running;
        let debug_str = format!("{:?}", state);
        assert!(debug_str.contains("Running"));
    }

    #[test]
    fn test_session_state_implements_clone() {
        let state = SessionState::Running;
        let cloned = state.clone();
        assert_eq!(state, cloned);
    }

    #[test]
    fn test_session_state_implements_partial_eq() {
        assert_eq!(SessionState::Creating, SessionState::Creating);
        assert_ne!(SessionState::Creating, SessionState::Running);
    }

    // Test: Valid state transitions
    #[test]
    fn test_valid_transition_creating_to_running() {
        let result = SessionState::Creating.can_transition_to(&SessionState::Running);
        assert!(result, "Creating -> Running should be valid");
    }

    #[test]
    fn test_valid_transition_creating_to_error() {
        let result = SessionState::Creating.can_transition_to(&SessionState::Error);
        assert!(result, "Creating -> Error should be valid");
    }

    #[test]
    fn test_valid_transition_running_to_closing() {
        let result = SessionState::Running.can_transition_to(&SessionState::Closing);
        assert!(result, "Running -> Closing should be valid");
    }

    #[test]
    fn test_valid_transition_running_to_error() {
        let result = SessionState::Running.can_transition_to(&SessionState::Error);
        assert!(result, "Running -> Error should be valid");
    }

    #[test]
    fn test_valid_transition_closing_to_closed() {
        let result = SessionState::Closing.can_transition_to(&SessionState::Closed);
        assert!(result, "Closing -> Closed should be valid");
    }

    #[test]
    fn test_valid_transition_closing_to_error() {
        let result = SessionState::Closing.can_transition_to(&SessionState::Error);
        assert!(result, "Closing -> Error should be valid");
    }

    // Test: Invalid state transitions
    #[test]
    fn test_invalid_transition_closed_to_running() {
        let result = SessionState::Closed.can_transition_to(&SessionState::Running);
        assert!(!result, "Closed -> Running should be invalid");
    }

    #[test]
    fn test_invalid_transition_closed_to_creating() {
        let result = SessionState::Closed.can_transition_to(&SessionState::Creating);
        assert!(!result, "Closed -> Creating should be invalid");
    }

    #[test]
    fn test_invalid_transition_error_to_running() {
        let result = SessionState::Error.can_transition_to(&SessionState::Running);
        assert!(!result, "Error -> Running should be invalid");
    }

    #[test]
    fn test_invalid_transition_running_to_creating() {
        let result = SessionState::Running.can_transition_to(&SessionState::Creating);
        assert!(!result, "Running -> Creating should be invalid");
    }

    #[test]
    fn test_invalid_transition_closing_to_running() {
        let result = SessionState::Closing.can_transition_to(&SessionState::Running);
        assert!(!result, "Closing -> Running should be invalid");
    }

    #[test]
    fn test_invalid_transition_closed_to_closing() {
        let result = SessionState::Closed.can_transition_to(&SessionState::Closing);
        assert!(!result, "Closed -> Closing should be invalid");
    }

    // Test: Transition to same state should be invalid (no-op but not allowed)
    #[test]
    fn test_invalid_transition_to_same_state() {
        assert!(!SessionState::Creating.can_transition_to(&SessionState::Creating));
        assert!(!SessionState::Running.can_transition_to(&SessionState::Running));
        assert!(!SessionState::Closing.can_transition_to(&SessionState::Closing));
        assert!(!SessionState::Closed.can_transition_to(&SessionState::Closed));
        assert!(!SessionState::Error.can_transition_to(&SessionState::Error));
    }

    // Test: SessionState can check if operations are allowed
    #[test]
    fn test_allows_input_when_running() {
        assert!(SessionState::Running.allows_input());
    }

    #[test]
    fn test_rejects_input_when_closed() {
        assert!(!SessionState::Closed.allows_input());
    }

    #[test]
    fn test_rejects_input_when_error() {
        assert!(!SessionState::Error.allows_input());
    }

    #[test]
    fn test_rejects_input_when_closing() {
        assert!(!SessionState::Closing.allows_input());
    }

    #[test]
    fn test_rejects_input_when_creating() {
        // Input should be rejected during creation as PTY may not be ready
        assert!(!SessionState::Creating.allows_input());
    }

    #[test]
    fn test_allows_resize_when_running() {
        assert!(SessionState::Running.allows_resize());
    }

    #[test]
    fn test_rejects_resize_when_closed() {
        assert!(!SessionState::Closed.allows_resize());
    }

    #[test]
    fn test_rejects_resize_when_error() {
        assert!(!SessionState::Error.allows_resize());
    }

    // ==================== Session State Field Tests ====================

    #[test]
    fn test_session_has_state_field() {
        let session = create_test_session();
        // State should exist and be accessible
        let _state = &session.state;
    }

    #[test]
    fn test_session_state_is_running_after_creation() {
        let session = create_test_session();
        assert_eq!(session.state, SessionState::Running,
            "Session state should be Running after successful creation");
    }

    #[test]
    fn test_session_transition_to_closing() {
        let mut session = create_test_session();
        assert!(session.transition_to(SessionState::Closing).is_ok(),
            "Transition from Running to Closing should succeed");
        assert_eq!(session.state, SessionState::Closing);
    }

    #[test]
    fn test_session_transition_to_closed() {
        let mut session = create_test_session();
        session.transition_to(SessionState::Closing).unwrap();
        assert!(session.transition_to(SessionState::Closed).is_ok(),
            "Transition from Closing to Closed should succeed");
        assert_eq!(session.state, SessionState::Closed);
    }

    #[test]
    fn test_session_invalid_transition_returns_error() {
        let mut session = create_test_session();
        session.transition_to(SessionState::Closing).unwrap();
        session.transition_to(SessionState::Closed).unwrap();

        let result = session.transition_to(SessionState::Running);
        assert!(result.is_err(), "Transition from Closed to Running should fail");
    }

    #[test]
    fn test_session_allows_input_delegates_to_state() {
        let mut session = create_test_session();
        assert!(session.allows_input(), "Running session should allow input");

        session.transition_to(SessionState::Closing).unwrap();
        assert!(!session.allows_input(), "Closing session should not allow input");

        session.transition_to(SessionState::Closed).unwrap();
        assert!(!session.allows_input(), "Closed session should not allow input");
    }

    #[test]
    fn test_session_allows_resize_delegates_to_state() {
        let mut session = create_test_session();
        assert!(session.allows_resize(), "Running session should allow resize");

        session.transition_to(SessionState::Closing).unwrap();
        assert!(!session.allows_resize(), "Closing session should not allow resize");

        session.transition_to(SessionState::Closed).unwrap();
        assert!(!session.allows_resize(), "Closed session should not allow resize");
    }

    #[test]
    fn test_session_transition_to_error_from_running() {
        let mut session = create_test_session();
        assert!(session.transition_to(SessionState::Error).is_ok(),
            "Transition from Running to Error should succeed");
        assert_eq!(session.state, SessionState::Error);
        assert!(!session.allows_input(), "Error session should not allow input");
        assert!(!session.allows_resize(), "Error session should not allow resize");
    }

    // ==================== Task 3.3.4: Broadcast Subscriber Cleanup Tests ====================

    #[test]
    fn test_session_subscriber_count_starts_at_zero() {
        let session = create_test_session();
        // No receivers have subscribed yet (the _rx from create_test_session was dropped)
        assert_eq!(session.subscriber_count(), 0,
            "New session should have 0 subscribers");
    }

    #[test]
    fn test_session_subscriber_count_tracks_subscriptions() {
        let session = create_test_session();
        let _rx1 = session.output_tx.subscribe();
        assert_eq!(session.subscriber_count(), 1,
            "Should have 1 subscriber after first subscribe");

        let _rx2 = session.output_tx.subscribe();
        assert_eq!(session.subscriber_count(), 2,
            "Should have 2 subscribers after second subscribe");
    }

    #[test]
    fn test_session_subscriber_count_decreases_on_drop() {
        let session = create_test_session();
        let rx1 = session.output_tx.subscribe();
        let _rx2 = session.output_tx.subscribe();
        assert_eq!(session.subscriber_count(), 2);

        drop(rx1);
        assert_eq!(session.subscriber_count(), 1,
            "Should have 1 subscriber after dropping one");
    }

    #[test]
    fn test_session_drop_logs_subscriber_info() {
        // This test verifies the Drop impl runs without panic when subscribers exist
        let session = create_test_session();
        let _rx1 = session.output_tx.subscribe();
        let _rx2 = session.output_tx.subscribe();

        // Drop the session - should log subscriber count and clean up
        drop(session);
        // If we get here without panic, the enhanced Drop works
    }
}
