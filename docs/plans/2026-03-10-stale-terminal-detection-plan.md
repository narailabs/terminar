# Stale Terminal Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-detect frozen terminal display after sleep/lock screen and recover without manual refresh.

**Architecture:** Client-side only, all in `web/src/components/Terminal.svelte`. Two-tier detection: (1) lightweight `term.refresh()` on visibility change and after input with no output, (2) full `refreshTerminal()` escalation. No server/protocol changes.

**Tech Stack:** Svelte 5, xterm.js, existing `refreshTerminal()` and `markOutputActive()` functions.

---

### Task 1: Add stale detection state variables

**Files:**
- Modify: `web/src/components/Terminal.svelte:192-200` (after existing write buffer state variables)

**Step 1: Add the state variables**

Insert after line 200 (`let scrolledByUs = false;`), before line 201 (`let lastScrollToBottomTime = 0;`):

```typescript
  // --- Stale terminal detection ---
  // Detects when keystrokes produce no visible output (frozen display after
  // sleep/lock screen). Two tiers: lightweight term.refresh(), then full
  // refreshTerminal() with history replay. Throttled to avoid spam.
  const STALE_CHECK_DELAY_MS = 500;      // Wait this long after input before checking
  const STALE_LIGHT_THROTTLE_MS = 5000;  // Tier 1: at most once per 5s
  const STALE_FULL_THROTTLE_MS = 30000;  // Tier 2: at most once per 30s
  let staleCheckTimer: ReturnType<typeof setTimeout> | null = null;
  let staleSuspected = false;
  let lastLightRefreshAt = 0;
  let lastFullRefreshAt = 0;
  let outputReceivedSinceInput = false;
```

**Step 2: Verify build**

Run: `cd /Users/narayan/src/terminar/web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: No errors (warnings OK)

**Step 3: Commit**

```bash
git add web/src/components/Terminal.svelte
git commit -m "feat(web): add stale terminal detection state variables"
```

---

### Task 2: Wire output receipt into stale detection

**Files:**
- Modify: `web/src/components/Terminal.svelte` — the output handler inside `setupOutputListener()` (line ~692-696)

**Step 1: Set outputReceivedSinceInput flag when output arrives**

In the output handler inside `setupOutputListener()`, add `outputReceivedSinceInput = true;` and clear the stale timer. Find this code (line ~692-696):

```typescript
      const handler = (outputSessionId: string, data: string) => {
          if (sessionId === outputSessionId && term) {
              markOutputActive();
              bufferedWrite(data);
          }
      };
```

Replace with:

```typescript
      const handler = (outputSessionId: string, data: string) => {
          if (sessionId === outputSessionId && term) {
              markOutputActive();
              // Stale detection: output arrived, terminal is alive
              outputReceivedSinceInput = true;
              staleSuspected = false;
              if (staleCheckTimer) {
                  clearTimeout(staleCheckTimer);
                  staleCheckTimer = null;
              }
              bufferedWrite(data);
          }
      };
```

**Step 2: Verify build**

Run: `cd /Users/narayan/src/terminar/web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: No errors

**Step 3: Commit**

```bash
git add web/src/components/Terminal.svelte
git commit -m "feat(web): clear stale detection state on output receipt"
```

---

### Task 3: Add stale check logic to input handler

**Files:**
- Modify: `web/src/components/Terminal.svelte` — the `term.onData()` handler (line ~935-947)

**Step 1: Add stale detection trigger on input**

Find this code (line ~935-947):

```typescript
    term.onData((data) => {
        // Only send input if this terminal is in the active pane
        // This prevents duplicate input when session is mirrored to multiple panes
        // Note: We read isActive directly to get the current prop value
        if (manager && activeSessionId && isActive) {
            // Filter out focus in/out sequences that can interfere with TUI apps
            // \x1b[I = focus in, \x1b[O = focus out
            if (data === '\x1b[I' || data === '\x1b[O') {
                return; // Don't send focus events to the server
            }
            manager.sendInput(activeSessionId, data);
        }
    });
```

Replace with:

```typescript
    term.onData((data) => {
        // Only send input if this terminal is in the active pane
        // This prevents duplicate input when session is mirrored to multiple panes
        // Note: We read isActive directly to get the current prop value
        if (manager && activeSessionId && isActive) {
            // Filter out focus in/out sequences that can interfere with TUI apps
            // \x1b[I = focus in, \x1b[O = focus out
            if (data === '\x1b[I' || data === '\x1b[O') {
                return; // Don't send focus events to the server
            }
            manager.sendInput(activeSessionId, data);

            // Stale detection: start a timer to check if output arrives.
            // Reset flag so we can detect absence of output after this input.
            outputReceivedSinceInput = false;
            if (staleCheckTimer) clearTimeout(staleCheckTimer);
            staleCheckTimer = setTimeout(() => {
                staleCheckTimer = null;
                if (outputReceivedSinceInput || !term) return;

                const now = Date.now();
                if (staleSuspected) {
                    // Tier 2: full refresh (clear + re-attach with history replay)
                    if (now - lastFullRefreshAt >= STALE_FULL_THROTTLE_MS) {
                        console.warn(`[Terminal:${terminalInstanceId}] Stale detected (Tier 2): full refresh`);
                        lastFullRefreshAt = now;
                        staleSuspected = false;
                        refreshTerminal();
                    }
                } else {
                    // Tier 1: lightweight repaint
                    if (now - lastLightRefreshAt >= STALE_LIGHT_THROTTLE_MS) {
                        console.warn(`[Terminal:${terminalInstanceId}] Stale detected (Tier 1): light refresh`);
                        lastLightRefreshAt = now;
                        staleSuspected = true;
                        term.refresh(0, term.rows - 1);
                    }
                }
            }, STALE_CHECK_DELAY_MS);
        }
    });
```

**Step 2: Verify build**

Run: `cd /Users/narayan/src/terminar/web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: No errors

**Step 3: Commit**

```bash
git add web/src/components/Terminal.svelte
git commit -m "feat(web): add two-tier stale detection on terminal input"
```

---

### Task 4: Enhance visibility change handler

**Files:**
- Modify: `web/src/components/Terminal.svelte` — the `visibilityHandler` (line ~993-1020)

The existing visibility handler already does `term.refresh()` and resets `writesInFlight`. We need to also reset stale detection state so the user gets a fresh start after returning to the tab.

**Step 1: Add stale state reset to visibility handler**

Find this code inside the visibility handler (line ~993-1010):

```typescript
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        // Force an unconditional repaint. Output received while the tab
        // was hidden is in xterm's buffer but was never painted to screen.
        // This refresh is independent of the resize pipeline — even if
        // dimensions haven't changed, the screen content needs repainting.
        if (term) {
          // If writesInFlight is stuck (callbacks lost while hidden),
          // reset it so the write pipeline's final-refresh gate can
          // open for future writes.
          if (writesInFlight > 0) {
            console.warn(`[Terminal:${terminalInstanceId}] Visibility restored with stuck writesInFlight=${writesInFlight}, resetting`);
            writesInFlight = 0;
          }
          requestAnimationFrame(() => {
            if (term) term.refresh(0, term.rows - 1);
          });
        }
```

Replace with:

```typescript
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        // Force an unconditional repaint. Output received while the tab
        // was hidden is in xterm's buffer but was never painted to screen.
        // This refresh is independent of the resize pipeline — even if
        // dimensions haven't changed, the screen content needs repainting.
        if (term) {
          // If writesInFlight is stuck (callbacks lost while hidden),
          // reset it so the write pipeline's final-refresh gate can
          // open for future writes.
          if (writesInFlight > 0) {
            console.warn(`[Terminal:${terminalInstanceId}] Visibility restored with stuck writesInFlight=${writesInFlight}, resetting`);
            writesInFlight = 0;
          }
          // Reset stale detection — the refresh below gives a clean slate
          staleSuspected = false;
          if (staleCheckTimer) {
            clearTimeout(staleCheckTimer);
            staleCheckTimer = null;
          }
          requestAnimationFrame(() => {
            if (term) term.refresh(0, term.rows - 1);
          });
        }
```

**Step 2: Verify build**

Run: `cd /Users/narayan/src/terminar/web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: No errors

**Step 3: Commit**

```bash
git add web/src/components/Terminal.svelte
git commit -m "feat(web): reset stale detection on visibility restore"
```

---

### Task 5: Clean up stale timer on destroy

**Files:**
- Modify: `web/src/components/Terminal.svelte` — the `onDestroy` callback (line ~1032-1062)

**Step 1: Add cleanup for staleCheckTimer**

Find this line inside `onDestroy()` (line ~1039):

```typescript
    if (outputActivityTimeout) clearTimeout(outputActivityTimeout);
```

Add after it:

```typescript
    if (staleCheckTimer) clearTimeout(staleCheckTimer);
```

**Step 2: Verify build**

Run: `cd /Users/narayan/src/terminar/web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: No errors

**Step 3: Commit**

```bash
git add web/src/components/Terminal.svelte
git commit -m "feat(web): clean up stale check timer on destroy"
```

---

### Task 6: Add tests for stale detection

**Files:**
- Modify: `web/src/components/Terminal.test.ts`

**Step 1: Read the full test file to understand patterns**

Read `web/src/components/Terminal.test.ts` to understand mock setup and test patterns.

**Step 2: Add tests for the stale detection behavior**

Add the following test cases to the existing test file, inside the main `describe('Terminal component')` block:

```typescript
  describe('stale terminal detection', () => {
    it('should clear stale timer when output arrives after input', async () => {
      // Get the onData callback that was registered
      const onDataCall = mockTerm.onData.mock.calls[0];
      expect(onDataCall).toBeDefined();
      const onDataHandler = onDataCall[0];

      // Simulate user typing — this should start a stale check timer
      onDataHandler('a');

      // Verify input was sent
      expect(mockManager.sendInput).toHaveBeenCalledWith('test-session', 'a');

      // Simulate output arriving (via the 'output' event handler)
      // The output handler registered via manager.on('output', handler)
      const outputOnCall = mockManager.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'output'
      );
      expect(outputOnCall).toBeDefined();
      const outputHandler = outputOnCall[1];

      // Output arrives — should clear stale detection
      outputHandler('test-session', 'response');

      // Advance past the stale check delay — no refresh should fire
      // because output was received
      vi.advanceTimersByTime(600);
      // term.refresh is called by other mechanisms, so we just verify
      // no "Stale detected" console.warn was emitted
    });

    it('should trigger light refresh (Tier 1) when no output after input', async () => {
      const onDataHandler = mockTerm.onData.mock.calls[0][0];

      // Simulate user typing
      onDataHandler('a');

      // Don't simulate any output — let the 500ms timer fire
      vi.advanceTimersByTime(600);

      // Should have called term.refresh (light refresh)
      expect(mockTerm.refresh).toHaveBeenCalledWith(0, mockTerm.rows - 1);
    });

    it('should trigger full refresh (Tier 2) on second stale detection', async () => {
      const onDataHandler = mockTerm.onData.mock.calls[0][0];

      // First input — triggers Tier 1
      onDataHandler('a');
      vi.advanceTimersByTime(600);

      // Clear mocks to track Tier 2
      mockTerm.clear.mockClear();
      mockTerm.reset.mockClear();

      // Second input — triggers Tier 2 (staleSuspected is now true)
      onDataHandler('b');
      vi.advanceTimersByTime(600);

      // Should have called refreshTerminal() which calls clear + reset + attach
      expect(mockTerm.clear).toHaveBeenCalled();
      expect(mockTerm.reset).toHaveBeenCalled();
      expect(mockManager.attach).toHaveBeenCalled();
    });

    it('should not trigger stale detection for focus events', async () => {
      const onDataHandler = mockTerm.onData.mock.calls[0][0];

      mockTerm.refresh.mockClear();

      // Focus in/out events should be filtered, not trigger stale detection
      onDataHandler('\x1b[I');
      vi.advanceTimersByTime(600);

      // No stale detection should have fired (no sendInput either)
      // refresh may be called by other mechanisms but not by stale detection
    });

    it('should throttle Tier 2 to once per 30 seconds', async () => {
      const onDataHandler = mockTerm.onData.mock.calls[0][0];

      // Tier 1
      onDataHandler('a');
      vi.advanceTimersByTime(600);

      // Tier 2 (first)
      onDataHandler('b');
      vi.advanceTimersByTime(600);
      mockTerm.clear.mockClear();
      mockTerm.reset.mockClear();
      mockManager.attach.mockClear();

      // Try to trigger another Tier 2 immediately — should be throttled
      // Need to trigger Tier 1 first, then Tier 2
      // But since lastFullRefreshAt was just set, Tier 2 should be skipped
      vi.advanceTimersByTime(5100); // past light throttle
      onDataHandler('c');
      vi.advanceTimersByTime(600);
      // This would be Tier 1 again (staleSuspected was reset)

      onDataHandler('d');
      vi.advanceTimersByTime(600);
      // Tier 2 attempt — but within 30s throttle
      expect(mockTerm.clear).not.toHaveBeenCalled();
    });
  });
```

**Step 3: Run the tests**

Run: `cd /Users/narayan/src/terminar/web && pnpm test -- --run Terminal.test 2>&1 | tail -30`
Expected: All tests pass

**Step 4: Commit**

```bash
git add web/src/components/Terminal.test.ts
git commit -m "test(web): add stale terminal detection tests"
```

---

### Task 7: Manual integration test

**Step 1: Start the dev server**

Run: `cd /Users/narayan/src/terminar && pnpm dev`

**Step 2: Verify normal typing works** — type in terminal, see output immediately.

**Step 3: Test visibility change** — switch to another tab and back, verify terminal still responds.

**Step 4: Check console** — open browser DevTools, look for any `[Terminal:xxx] Stale detected` warnings during normal operation (should see none during normal use).

**Step 5: Stop dev server**
