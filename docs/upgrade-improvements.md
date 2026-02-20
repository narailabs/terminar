# Codebase Upgrade Improvement Opportunities

After upgrading to Svelte 5, xterm.js v6, Vite 7, TypeScript 5.9, Zod v4, Vitest v4, Electron 40, and electron-builder v26, the codebase has many opportunities to leverage new features and remove legacy patterns. The tray app renderer already uses Svelte 5 runes, but the web frontend and protocol layers still use older patterns.

This document catalogs all findings organized by area and priority, with a recommended execution order so we can tackle changes one at a time and verify nothing breaks.

---

## Area 1: Web Frontend — Svelte 5 Runes Migration

**All 20 components** still use Svelte 4 patterns (`export let`, `$:`, `createEventDispatcher`, `on:event`). The tray renderer (`tray/src/renderer/`) is already fully migrated to runes — the web frontend is not.

### W1: `export let` → `$props()`

- **Files**: All 20 components in `web/src/components/`
- **Risk**: Low-Medium
- **Effort**: High (cumulative across all components)
- **Details**: Every component uses `export let` for props. Svelte 5 replaces this with `let { prop1, prop2 } = $props()`. Do per-component alongside other rune changes. Start with leaf components (ConnectionStatus, BroadcastBar, SplitHandle) and work up.

### W2: `createEventDispatcher` → callback props

- **Files**: 11 components — Sidebar, Pane, SplitContainer, TabBar, SearchBar, LoginPage, SettingsPanel, SplitHandle, TerminalList, TerminalContextMenu, WorkspaceView
- **Risk**: Medium
- **Effort**: Medium-High
- **Details**: Svelte 5 replaces `createEventDispatcher()` + `dispatch('eventName', data)` + `on:eventName` with callback props: `let { onEventName } = $props()` and `onEventName?.(data)`. Parent components must also be updated to pass callbacks instead of using `on:eventName`. Event dispatcher chains (e.g., SplitContainer → WorkspaceView) must be migrated together.

### W3: `$:` → `$derived` (simple derivations)

- **Files**: ConnectionStatus, BroadcastBar, Pane, WorkspaceView, SettingsPanel
- **Risk**: Low
- **Effort**: Low
- **Details**: Simple computed values like `$: isConnected = status === 'connected'` become `let isConnected = $derived(status === 'connected')`. These are mechanical replacements for any `$:` that purely computes a value without side effects.

### W4: `$:` → `$effect` (side effects)

- **Files**: App.svelte, Terminal.svelte, Pane.svelte, SearchBar
- **Risk**: Medium-High
- **Effort**: Medium
- **Details**: Reactive statements with side effects (`$: { doSomething(dep) }`) must use `$effect(() => { ... })`. Key considerations:
  - `$effect` runs after DOM update (like `afterUpdate`), not synchronously
  - Dependencies are auto-tracked (no explicit dep list)
  - Return a cleanup function for teardown
  - Terminal.svelte has complex session attachment logic — migrate carefully

### W5: `onMount`/`onDestroy` → `$effect` with cleanup

- **Files**: App, Terminal, SettingsPanel, SearchBar, Pane
- **Risk**: Low-High (depends on component complexity)
- **Effort**: Medium
- **Details**: Pattern: `onMount(() => { setup(); return () => cleanup() })` becomes `$effect(() => { setup(); return () => cleanup() })`. Note: `$effect` runs after mount and re-runs when dependencies change. For truly one-time setup with no reactive deps, `onMount` is still valid in Svelte 5 — only migrate when it simplifies the code.

### W6: `on:click` → `onclick` template syntax

- **Files**: All components with event handlers
- **Risk**: Low
- **Effort**: Low (mechanical)
- **Details**: Svelte 5 uses standard HTML event attributes: `on:click={handler}` → `onclick={handler}`, `on:keydown` → `onkeydown`, etc. Do per-component alongside other migrations. Event modifiers like `|preventDefault` must be replaced with explicit calls in the handler.

### W7: `svelte:window on:event` → `svelte:window onevent`

- **Files**: Pane, WorkspaceView
- **Risk**: Low
- **Effort**: Low
- **Details**: Same syntax change as W6 but for `<svelte:window>`: `<svelte:window on:resize={handler}/>` → `<svelte:window onresize={handler}/>`.

### W8: Manual store subscriptions → `$derived`

- **Files**: Pane.svelte (searchStore, settingsStore)
- **Risk**: Low
- **Effort**: Low
- **Details**: Components that manually subscribe to stores via `$storeName` and use the value in computations can often replace this with `$derived`. Particularly relevant for Pane.svelte's use of searchStore and settingsStore.

### W9: `writable()` autoScroll → `$state`

- **Files**: Terminal.svelte
- **Risk**: Medium
- **Effort**: Medium
- **Details**: The `autoScroll` store in Terminal.svelte was converted from `let` to `writable()` to fix a Svelte 4 reactivity issue (vanilla JS callbacks don't trigger re-renders). With Svelte 5 runes, `$state` provides fine-grained reactivity that works everywhere, including `addEventListener` callbacks. **Caution**: The auto-scroll listener is a sensitive area (see MEMORY.md notes) — test thoroughly.

### W10: Store files `.ts` → `.svelte.ts` with `$state`

- **Files**: ~10 store files in `web/src/lib/` (connectionStore, searchStore, settingsStore, sidebarStore, themeStore, workspaceStore, etc.)
- **Risk**: Low
- **Effort**: High
- **Details**: Svelte 5 introduces `.svelte.ts` files that can use runes outside components. Stores using `writable()`/`readable()` can be rewritten with `$state` and `$derived`. This is a large migration best done after components are migrated. The stores are imported across many components, so each store migration may require updating importers.

### W11: Context API writable stores → runes-based

- **Files**: `web/src/lib/sessionContext.ts`
- **Risk**: Medium
- **Effort**: Medium
- **Details**: The session context currently uses writable stores for context values. With Svelte 5, context can hold `$state` objects directly, and consumers use `$derived` to react to changes. This interacts with the test wrapper pattern (see W15).

### W12: Terminal exported methods + `bind:this`

- **Files**: Terminal.svelte, Pane.svelte
- **Risk**: High
- **Effort**: High
- **Details**: Terminal.svelte exports methods that Pane.svelte calls via `bind:this`. In Svelte 5, component instances from `bind:this` only expose methods explicitly exported with `export function`. The migration requires careful handling of the Terminal API surface (focus, fitToContainer, scrollToBottom, clear, getSearchAddon, etc.). Consider whether a different pattern (shared state object, context) would be cleaner.

### W13: `require()` in test mocks → `vi.hoisted()`

- **Files**: App.test.ts, AppToolbar.test.ts, settingsStore.test.ts
- **Risk**: Low
- **Effort**: Low
- **Details**: Vitest v4 provides `vi.hoisted()` for declaring variables that need to be available in `vi.mock()` factory functions. Replace patterns like `const mockX = vi.fn(); vi.mock('./x', () => ({ default: mockX }))` (which relies on hoisting behavior) with explicit `const { mockX } = vi.hoisted(() => ({ mockX: vi.fn() }))`.

### W14: Remove redundant `globals: true` in vitest

- **Files**: `web/vite.config.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: Vitest v4 may have changed defaults for `globals`. Check if `globals: true` is still needed or if tests explicitly import from vitest.

### W15: Test wrapper patterns for Svelte 5 components

- **Files**: Various test files in `web/src/`
- **Risk**: Medium
- **Effort**: Medium
- **Details**: `@testing-library/svelte` needs to be compatible with Svelte 5's rendering. Test wrappers (e.g., `WorkspaceViewTestWrapper.svelte`) may need updates. The `hasContext()` fallback pattern for testing should still work but verify against Svelte 5's context implementation.

---

## Area 2: Protocol & TypeScript

### P1: **BUG** — `CwdChanged` in `parse.ts` but missing from Zod schema

- **Files**: `packages/shell-protocol/src/parse.ts` vs `packages/shell-protocol/src/messages.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: `parse.ts` handles a `CwdChanged` message type in its manual parsing, but there is no corresponding Zod schema in `messages.ts`. Either add the schema (if the server sends this message) or remove the dead parsing branch. Check server-side `messages.rs` to determine which.

### P2: Dual validation system → unify with `zod/mini`

- **Files**: `packages/shell-protocol/src/parse.ts`, `packages/shell-protocol/src/messages.ts`
- **Risk**: Medium
- **Effort**: Medium
- **Details**: The protocol currently has two validation paths: manual JSON parsing in `parse.ts` and Zod schemas in `messages.ts`. Zod v4 introduces `zod/mini` — a tree-shakeable, smaller alternative. Consider unifying into a single Zod-based parsing pipeline. This could simplify maintenance and ensure schema + parsing never diverge (see P1).

### P3: `z.discriminatedUnion` → `z.union`

- **Files**: `packages/shell-protocol/src/messages.ts` (lines ~18, ~46)
- **Risk**: Low
- **Effort**: Low
- **Details**: Zod v4 auto-detects discriminated unions when using `z.union`. The explicit `z.discriminatedUnion('type', [...])` can be simplified to `z.union([...])` — Zod v4 will internally optimize it the same way. Reduces API surface and one less thing to maintain.

### P4: `state: z.string()` → `z.enum`

- **Files**: `packages/shell-protocol/src/messages.ts` (line ~10)
- **Risk**: Low
- **Effort**: Low
- **Details**: The `state` field in `SessionInfo` accepts any string, but the server only sends `'running'`, `'exited'`, `'closed'`, or `'error'`. Tightening to `z.enum(['running', 'exited', 'closed', 'error'])` catches invalid states at parse time and provides TypeScript literal types.

### P5: `mode: z.string()` → `z.enum`

- **Files**: `packages/shell-protocol/src/messages.ts` (line ~29)
- **Risk**: Low
- **Effort**: Low
- **Details**: Similar to P4 — the `mode` field in `AttachSession` only accepts `'mirror'` or `'exclusive'`. Use `z.enum(['mirror', 'exclusive'])`.

### P6: Shared `session_id` base schema with `z.object().extend()`

- **Files**: `packages/shell-protocol/src/messages.ts` (lines ~29–33)
- **Risk**: Low
- **Effort**: Low
- **Details**: Multiple message schemas repeat `session_id: z.string()`. Extract a base schema and use `.extend()` for DRYer definitions. Example: `const WithSessionId = z.object({ session_id: z.string() }); const AttachSession = WithSessionId.extend({ mode: ... })`.

### P7: `z.prettifyError()` for better error messages

- **Files**: `packages/shell-protocol/src/client.ts` (line ~58)
- **Risk**: Low
- **Effort**: Low
- **Details**: Zod v4 adds `z.prettifyError()` for human-readable error formatting. Use it in validation error paths for better debugging output.

### P8: `satisfies` for exhaustive ErrorCode → class mapping

- **Files**: `packages/shell-protocol/src/errors.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: If there's a mapping from error codes to error classes, use `satisfies Record<ErrorCode, ...>` to ensure exhaustiveness at compile time. TypeScript will error if a new error code is added without a corresponding mapping.

### P9: 6x duplicated `SessionInfo` interface → single Zod source

- **Files**: 6 files across `packages/shell-protocol/`, `web/src/lib/`, `extension/src/`
- **Risk**: Medium
- **Effort**: Medium
- **Details**: The `SessionInfo` type is defined or re-declared in multiple places. With Zod schemas as the source of truth, use `z.infer<typeof SessionInfoSchema>` everywhere and export the inferred type from the protocol package. Remove hand-written interfaces.

### P10: Duplicated `ConnectionState`/`ReconnectConfig` → import from protocol

- **Files**: `extension/src/SessionManager.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: The extension re-declares `ConnectionState` and `ReconnectConfig` types that already exist in the protocol package. Import from `@narai/terminar-protocol` instead.

### P11: Duplicated `IShellSocket` → import from shared-protocol barrel

- **Files**: `web/src/lib/WebSocketAdapter.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: The web frontend re-declares the `IShellSocket` interface. Import it from the shared protocol barrel (`shared-protocol.ts`) instead.

### P12: `as any`/`as unknown` casts → proper types

- **Files**: `packages/shell-protocol/src/websocket-manager.ts`, `extension/src/SessionTreeProvider.ts`, `web/src/lib/WebSocketAdapter.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: Several files use type assertions to work around type mismatches. Investigate each cast and replace with proper typing (generic parameters, interface implementations, or discriminated unions).

### P13: `as const satisfies` for `DEFAULT_SETTINGS`

- **Files**: `web/src/lib/settingsStore.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: Use `as const satisfies SettingsType` for the default settings object. This gives both literal types (for better inference) and type checking (ensuring the object matches the settings shape).

### P14: Typed EventEmitter interfaces

- **Files**: `packages/shell-protocol/src/client.ts`, `packages/shell-protocol/src/websocket-manager.ts`, `extension/src/SessionManager.ts`
- **Risk**: Medium
- **Effort**: Medium
- **Details**: EventEmitters currently use string event names with no type safety on payloads. Define typed event maps and use them to constrain `on()`/`emit()` calls. This catches mismatched event names and payload types at compile time.

---

## Area 3: Tray App & Electron

### T1: `app.on('ready')` → `app.whenReady()`

- **Files**: `tray/src/main/index.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: Electron's `app.whenReady()` returns a Promise and is the recommended pattern over the callback-based `app.on('ready', ...)`. It also handles the case where the app is already ready.

### T2: Add `sandbox: true` to BrowserWindow

- **Files**: `tray/src/main/WindowManager.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: Electron 40 defaults to `sandbox: false` for backwards compatibility, but sandboxing is strongly recommended for security. Since the tray app uses a preload script with `contextBridge`, adding `sandbox: true` should work without changes. Verify the preload script doesn't use Node.js APIs directly.

### T3: Add Content Security Policy

- **Files**: `tray/src/main/WindowManager.ts` or renderer `index.html`
- **Risk**: Low
- **Effort**: Low-Medium
- **Details**: Add a CSP meta tag or use `session.defaultSession.webRequest.onHeadersReceived` to set CSP headers. A reasonable starting policy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`. This prevents XSS attacks in the renderer process.

### T4: HealthPoller EventEmitter → typed callback

- **Files**: `tray/src/main/HealthPoller.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: If HealthPoller extends EventEmitter with string event names, replace with a typed callback pattern: `constructor(private onStatusChange: (status: HealthStatus) => void)`. Simpler, type-safe, and no event name typo risk.

### T5: `handleMenuEvent(id: string)` → union type

- **Files**: `tray/src/main/TrayManager.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: If menu event IDs are handled via string matching, define a union type of valid IDs: `type MenuAction = 'open-settings' | 'quit' | ...` and use exhaustive switch. TypeScript will catch unhandled cases.

### T6: `any` in preload → `TrayConfig` type

- **Files**: `tray/src/preload/index.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: The preload bridge may use `any` for config objects. Import and use the proper `TrayConfig` type for type safety across the IPC boundary.

### T7: Duplicate `TrayConfig` → shared types file

- **Files**: `tray/src/main/types.ts` vs `tray/src/renderer/lib/api.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: The `TrayConfig` type (or similar config shape) may be defined in both the main process and renderer. Extract to a shared types file that both can import. Since renderer can't import from main directly (different build targets), use a shared `tray/src/shared/` or `tray/src/types/` directory.

### T8: Non-null assertions in menuSpec → defaults

- **Files**: `tray/src/main/menuSpec.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: Replace `config.field!` non-null assertions with default values: `config.field ?? defaultValue`. This is safer and makes the code's assumptions explicit.

### T9: tsconfig target ES2022 → ES2024

- **Files**: `tray/tsconfig.json`
- **Risk**: Low
- **Effort**: Low
- **Details**: Electron 40 uses a Chromium version that supports ES2024 features. Update the tsconfig target to enable newer JavaScript features like `Object.groupBy`, `Promise.withResolvers`, etc.

### T10: `require('fs')` → ESM import in test

- **Files**: `tray/tests/elevation.test.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: The tray app uses `"type": "module"` but tests may still use `require()`. Replace with ESM `import` syntax for consistency.

### T11: `Function` type → specific signatures in tests

- **Files**: `tray/tests/elevation.test.ts`, `tray/tests/electron-app.test.ts`
- **Risk**: Low
- **Effort**: Low
- **Details**: The `Function` type is overly broad. Replace with specific function signatures like `(...args: unknown[]) => void` or the actual expected signature.

### T12: `setTimeout` waits → Playwright `expect.poll()`

- **Files**: `tray/tests/electron-app.test.ts`
- **Risk**: Low
- **Effort**: Low-Medium
- **Details**: E2E tests using `setTimeout`/`sleep` for timing are flaky. Playwright's `expect.poll()` and `expect.toPass()` provide deterministic polling that waits only as long as needed.

### T13: WebUIManager detached process cleanup

- **Files**: `tray/src/main/WebUIManager.ts`
- **Risk**: Medium
- **Effort**: Low
- **Details**: If WebUIManager spawns detached child processes (e.g., for the web UI dev server), ensure they're properly killed on app quit. Use `app.on('before-quit')` or `app.on('will-quit')` to clean up.

### T14: `$effect` → `untrack` for one-time load

- **Files**: `tray/src/renderer/Settings.svelte`
- **Risk**: Low
- **Effort**: Low
- **Details**: If Settings.svelte uses `$effect` to load initial data but doesn't want re-runs when dependencies change, use `untrack(() => ...)` inside the effect to read values without subscribing to them. Alternatively, if it's truly one-time, `onMount` is clearer.

---

## Area 4: Rust Dependencies

### R1: `thiserror` 1.0 → 2.0

- **Current**: 1.0
- **Target**: 2.0
- **Risk**: Medium
- **Details**: thiserror 2.0 changed the derive macro syntax. `#[error("...")]` attributes may need updates. The `#[from]` attribute behavior is the same. Review all error types in `server/src/`.

### R2: `tokio-tungstenite` (dev) 0.20 → 0.24+

- **Current**: 0.20
- **Target**: 0.24+
- **Risk**: Low
- **Details**: Dev dependency used in integration tests. API changes are minor. Update and fix any compile errors in test code.

### R3: `reqwest` (dev) 0.11 → 0.12

- **Current**: 0.11
- **Target**: 0.12
- **Risk**: Low
- **Details**: Dev dependency used in integration tests. reqwest 0.12 has minor API changes (builder pattern adjustments). Update and fix test code.

### R4: `tower`/`tower-http` 0.4/0.5 → 0.5/0.6

- **Current**: tower 0.4, tower-http 0.5
- **Target**: tower 0.5, tower-http 0.6
- **Risk**: Medium
- **Details**: tower 0.5 changed the `Service` trait. `tower-http` layers may need updates. This affects the HTTP server setup in `lib.rs` and gateway routing. Test thoroughly.

### R5: Rust edition 2021 → 2024

- **Current**: 2021
- **Target**: 2024
- **Risk**: Medium
- **Details**: Rust 2024 edition brings: `gen` keyword reservation, `unsafe_op_in_unsafe_fn` lint, changes to `impl Trait` capture rules, and more. Run `cargo fix --edition` to auto-fix most issues, then review manually.

---

## Recommended Execution Order

### Phase 1: Bug fixes & quick wins (low risk, immediate value)

1. **P1** — Fix `CwdChanged` missing from Zod schema (bug)
2. **P4, P5** — Tighten `state` and `mode` to enums
3. **T1** — `app.whenReady()`
4. **T2** — `sandbox: true`
5. **T9** — tsconfig ES2024
6. **T6, T8** — Preload types, menuSpec defaults
7. **P8** — `satisfies` for ErrorCode map
8. **W13** — `vi.hoisted()` in test mocks
9. **T10, T11** — Test code cleanup

### Phase 2: Type deduplication & schema improvements (low-medium risk)

1. **P10, P11** — Remove duplicated types (ConnectionState, IShellSocket)
2. **P3, P6, P7** — Zod v4 schema improvements
3. **P12, P13** — Remove `as any` casts, `as const satisfies`
4. **T4, T5, T7** — Typed callbacks, shared TrayConfig
5. **T3** — Content Security Policy

### Phase 3: Svelte 5 migration — leaf components first (medium risk)

1. **W3** — Simple `$:` → `$derived` (ConnectionStatus, BroadcastBar)
2. **W1** — `$props()` for leaf components (ConnectionStatus, BroadcastBar, SplitHandle)
3. **W7** — `svelte:window` event syntax
4. **W6** — `on:click` → `onclick` (do per-component alongside other changes)
5. **W8** — Manual subscriptions → `$derived` in Pane
6. **W5** — `onMount`/`onDestroy` → `$effect` (SettingsPanel, SearchBar)
7. **W2** — `createEventDispatcher` → callback props (start with leaves: SplitHandle, SearchBar, LoginPage)

### Phase 4: Svelte 5 migration — complex components (high risk)

1. **W1+W3+W4** — Pane.svelte full migration
2. **W2** — Event dispatcher chains (SplitContainer → WorkspaceView)
3. **W1+W3+W4** — WorkspaceView, App.svelte migration
4. **W9** — autoScroll `writable` → `$state` in Terminal
5. **W4** — Complex `$effect` in Terminal (session attachment)
6. **W12** — Terminal exported methods + `bind:this`

### Phase 5: Architectural improvements (medium risk, high value)

1. **P9** — Unify SessionInfo across packages
2. **P2** — Unify dual validation system with `zod/mini`
3. **P14** — Typed EventEmitter interfaces
4. **W10, W11** — Store files `.svelte.ts` migration + context API

### Phase 6: Rust dependency upgrades (batch together)

1. **R2, R3** — Dev dependencies (tokio-tungstenite, reqwest)
2. **R1** — thiserror 2.0
3. **R4** — tower/tower-http
4. **R5** — Rust edition 2024

---

## Verification

After each change:

1. `pnpm test:web` — web unit tests
2. `pnpm test:extension` — extension tests (after protocol changes)
3. `cd packages/shell-protocol && pnpm test -- --run && pnpm typecheck` — protocol tests + dead code check
4. `cd tray && pnpm test -- --run` — tray unit tests
5. `cd server && cargo test` — Rust tests (for Phase 6)
6. `pnpm dev` — manual smoke test (real PTY, not mock)
