# Auto-Scroll Fix — State & Context

## The Problem
When a fast program (Claude Code, etc.) is running, the user cannot scroll up to read earlier output — the terminal snaps back to the bottom.

## Files Modified
- `web/src/components/Terminal.svelte` — `initAutoScroll()` and `flushWriteBuffer()`
- `web/e2e/auto-scroll.spec.ts` — new E2E test file

## What Was Already Done Before This Session
- rAF write batching (`bufferedWrite`/`flushWriteBuffer`)
- An `autoScroll` flag
- `scrollOnOutput: false` on xterm.js constructor (line ~485)
- `applyResize` gated by `autoScroll` (line ~327)

## Root Cause (confirmed)
The original `scroll` event listener on `.xterm-viewport` re-enabled `autoScroll = true` during xterm internal DOM reflows triggered by `term.write()`. The `scroll` event fires from both user actions AND xterm's internal rendering. This listener has been REMOVED.

## Critical Finding: `scrollOnOutput` is a No-Op

**`scrollOnOutput` was removed from xterm.js 5.x** (we're on 5.3.0). It has:
- Zero occurrences in the xterm.js minified bundle
- No entry in the xterm.js 5.3.0 type definitions
- Is silently ignored by the constructor

**xterm.js 5.x does NOT auto-scroll on new output at all.** Our `term.scrollToBottom()` in `flushWriteBuffer()` is the **sole mechanism** controlling scroll-to-bottom behavior. This means:
- The `autoScroll` gating in `flushWriteBuffer` is the complete solution
- No xterm internal behavior can fight against it
- The approach is fundamentally sound

## What We Tried (4 iterations)

### Attempt 1: Remove scroll listener, deferred autoScroll=false
- Removed `scroll` listener entirely
- wheel deltaY < 0 → rAF → check not-at-bottom → `autoScroll = false`
- **FAILED**: Race condition. `flushWriteBuffer` calls `scrollToBottom()` before rAF sets flag.

### Attempt 2: Immediate autoScroll=false + save/restore scrollTop
- wheel up → `autoScroll = false` immediately
- `flushWriteBuffer`: save scrollTop before write, check autoScroll at callback time, restore if !autoScroll
- **FAILED**: `savedScrollTop` captured while autoScroll was still `true` (bottom position). Restores bottom position, snapping viewport back down.

### Attempt 3: Track wasAutoScroll + conditional restore
- Save `wasAutoScroll` flag + `savedScrollTop` at write time
- Callback: if `autoScroll` → scrollToBottom; if `!wasAutoScroll` → restore; if transition → do nothing
- **FAILED**: "Last line hidden" bug. The rAF re-enable + save/restore interact badly with tiny accidental trackpad gestures. Viewport gets locked near-bottom but outside the 5px threshold.

### Attempt 4 (CURRENT): No save/restore, gate scrollToBottom + keyboard support
- wheel up → `autoScroll = false` immediately + rAF re-enable if still at bottom
- Shift+PageUp → `autoScroll = false`; Shift+PageDown → rAF check if at bottom
- `flushWriteBuffer`: only calls `scrollToBottom()` when autoScroll is true. No save/restore.
- Extracted `isAtBottom()` helper and `BOTTOM_THRESHOLD` constant for DRY
- **E2E results**: Test 1 (auto-scroll works) ✓, Test 2 (scroll-up pauses) ✓, Test 3 (scroll-down resumes) — intermittently fails in E2E (test infrastructure timing, not logic issue)
- **NEEDS MANUAL TESTING** on Claude Code output

## Current Code State (Attempt 4 + keyboard)

### initAutoScroll()
```typescript
const BOTTOM_THRESHOLD = 5;

function isAtBottom(): boolean {
    if (!viewportElement) return true;
    const el = viewportElement as HTMLElement;
    return el.scrollTop >= el.scrollHeight - el.clientHeight - BOTTOM_THRESHOLD;
}

function initAutoScroll() {
    viewportElement = terminalContainer?.querySelector('.xterm-viewport');
    if (!viewportElement) return;

    // Mouse / trackpad
    viewportElement.addEventListener('wheel', ((e: WheelEvent) => {
      if (e.deltaY < 0) {
        autoScroll = false;
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll = true;
        });
      } else if (e.deltaY > 0 && !autoScroll) {
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll = true;
        });
      }
    }) as EventListener, { passive: true });

    // Keyboard scroll (Shift+PageUp / Shift+PageDown)
    terminalContainer.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!e.shiftKey) return;
      if (e.key === 'PageUp') {
        autoScroll = false;
      } else if (e.key === 'PageDown') {
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll = true;
        });
      }
    }, true);
  }
```

### flushWriteBuffer()
```typescript
function flushWriteBuffer() {
    writeRafId = null;
    if (!writeBuffer || !term) return;
    const data = writeBuffer;
    writeBuffer = '';
    term.write(data, () => {
      if (autoScroll && term) {
        term.scrollToBottom();
      }
    });
  }
```

## The Core Tension

Two bugs fight each other:

1. **"Can't scroll up"** — If `autoScroll` isn't set to `false` fast enough, `scrollToBottom()` runs and snaps back. Requires IMMEDIATE disable on wheel-up.

2. **"Last line hidden"** — If `autoScroll` is set to `false` too eagerly (tiny accidental trackpad gesture), the terminal stops auto-scrolling and the last line gets clipped. Requires re-enable mechanism.

The save/restore of scrollTop in `flushWriteBuffer` adds a THIRD failure mode and was removed in attempt 4.

## Other Places scrollToBottom Is Called
- `applyResize()` — gated by `autoScroll` ✓
- `refreshTerminal()` — only on manual refresh, always scrolls ✓
- Session attach code (line ~458) — only on session change, scrolls with 200/500/1000ms delays
- These should NOT cause issues during normal output flow

## E2E Test Notes
- `web/e2e/auto-scroll.spec.ts` — uses `page.evaluate` to set scrollTop + dispatch WheelEvent atomically
- `page.mouse.wheel()` fires real events but xterm/flushWriteBuffer override scrollTop within the same frame, making assertions unreliable
- `dispatchEvent('wheel', ...)` fires the JS event but the browser does NOT actually scroll
- Test 3 (scroll-down-to-bottom resumes) is intermittently flaky due to timing

## Other Context
- `scrollOnOutput: false` was in the constructor but is a no-op in xterm.js 5.3.0 (removed from API). Comment updated.
- Unit tests: 412 passing (28 files), not affected by these changes
- Playwright browsers installed at `/Users/narayan/Library/Caches/ms-playwright/`
