# Implementation Plan: termiNar System

This plan details the roadmap to take `terminar` from a prototype to a stable production release. It follows a Test-Driven Development (TDD) approach.

## Phase 1: Server Refactoring & Hardening (Rust)

Current state: Monolithic `main.rs` with basic features.
Goal: Modular, tested, secure server.

- [ ] **Task 1.1: Modularize Server Code**
    -   Extract `session.rs` (Session struct, SessionMap).
    -   Extract `pty.rs` (PTY abstraction/mocking).
    -   Extract `messages.rs` (Protocol types).
    -   *Test*: Existing tests must pass after refactor.
- [ ] **Task 1.2: Implement Authentication**
    -   Generate secure `API_KEY` on startup.
    -   Validate `Authorization: Bearer <token>` header in WebSocket handshake.
    -   *Test*: Unit test `auth.rs`, Integration test rejecting invalid tokens.
- [ ] **Task 1.3: Robust Error Handling & Logging**
    -   Replace `println!` with `tracing`.
    -   Handle PTY exit events gracefully (notify client, remove session).
    -   *Test*: Simulate PTY crash/exit and verify `SessionClosed` event.
- [ ] **Task 1.4: Configuration System**
    -   Add CLI args for port, socket path, log level.
    -   *Test*: Verify args parsing.

## Phase 2: Shared Protocol Library (TypeScript)

Current state: No shared library.
Goal: Type-safe communication between Frontend and Backend.

- [ ] **Task 2.1: Scaffold `packages/terminar-protocol`**
    -   Setup `package.json`, `tsconfig.json`.
    -   *Test*: Basic import test.
- [ ] **Task 2.2: Define Protocol Types**
    -   Port `ClientMessage` and `ServerMessage` structs from Rust to TypeScript interfaces.
    -   Add Zod schemas for validation (optional but recommended).
    -   *Test*: JSON schema validation tests.
- [ ] **Task 2.3: Implement Protocol Client**
    -   Create a `ShellClient` class that handles connection (WS/Unix), buffering, and event emitting.
    -   *Test*: Mock server tests for `ShellClient`.

## Phase 3: VS Code Extension (Frontend)

Current state: Basic scaffold.
Goal: Functional persistent terminal in VS Code.

- [ ] **Task 3.1: IPC Connection Manager**
    -   Implement connection to Unix socket using `net` module.
    -   Use `ShellClient` from Phase 2.
    -   *Test*: Connection retry logic tests.
- [ ] **Task 3.2: Terminal UI (Webview)**
    -   Create Webview provider.
    -   Embed `xterm.js`.
    -   Handle resizing and input forwarding.
    -   *Test*: Webview message passing tests.
- [ ] **Task 3.3: Session Management UI**
    -   Implement TreeView for "termiNars".
    -   Commands: `Create`, `Rename`, `Kill`, `Attach`.
    -   *Test*: TreeDataProvider tests.

## Phase 4: Remote Connectivity & Pairing

Current state: WSS exists but is insecure/unused.
Goal: Allow remote connection with "Pairing" flow.

- [ ] **Task 4.1: Pairing CLI Command (Server)**
    -   Implement `terminar pair` command.
    -   Generate short-lived 6-digit code.
    -   *Test*: Code generation and expiry tests.
- [ ] **Task 4.2: Pairing API (Server)**
    -   Endpoint to exchange Code for Auth Token.
    -   *Test*: API tests.
- [ ] **Task 4.3: Remote Connection Command (Extension)**
    -   Command `termiNar: Connect to Remote`.
    -   Input: Host, Pairing Code.
    -   Storage: Save token in `SecretStorage`.
    -   *Test*: Mock remote connection flow.

## Phase 5: Production Readiness

Goal: Stable, shippable artifacts.

- [ ] **Task 5.1: CI Pipelines**
    -   GitHub Action for Rust (build, test, lint).
    -   GitHub Action for Extension (compile, test, package).
- [ ] **Task 5.2: Packaging**
    -   Build `.vsix` for Extension.
    -   Build standalone binaries for Server (Linux/macOS/Windows).
    -   Bundle Server binary inside Extension (or download on install).
- [ ] **Task 5.3: Documentation**
    -   Update `README.md` with installation/usage.
    -   Create user guide.

## TDD Workflow for Each Task

1.  **Select Task**: Pick the next item.
2.  **Plan**: Create a micro-plan if needed.
3.  **Test**: Write a failing test (Rust `#[test]` or TS `*.test.ts`).
4.  **Implement**: Write code to pass the test.
5.  **Refactor**: Clean up.
6.  **Verify**: Run all tests.
