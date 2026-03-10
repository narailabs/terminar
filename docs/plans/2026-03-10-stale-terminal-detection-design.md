# Stale Terminal Detection & Auto-Recovery

## Problem

After the machine sleeps or the lock screen activates, the terminal display freezes. Keystrokes are sent but nothing renders. The PTY state is fine — a manual `refreshTerminal()` brings everything back. This is a client-side rendering issue caused by `requestAnimationFrame` stopping during sleep, possible WebGL context loss, or write buffer getting stuck.

## Solution

Two-tier client-side detection with automatic recovery, all in `Terminal.svelte`. No server or protocol changes.

## Detection Triggers

### 1. Visibility Change (proactive)

Listen for `document.visibilitychange`. When the page becomes visible again, immediately call `term.refresh(0, rows - 1)` (lightweight repaint). Handles the primary scenario: return from lock screen or tab switch.

### 2. Input-Triggered Stale Detection (reactive)

On every `term.onData()` (keystroke), start a 500ms timer. If output arrives within that window (`markOutputActive()`), clear the timer — terminal is alive. If the timer fires with no output:

- **Tier 1**: `term.refresh(0, rows - 1)` — lightweight repaint, no flicker. Set `staleSuspected = true`.
- **Tier 2**: If user types again while `staleSuspected` and still no output after 500ms, call `refreshTerminal()` — full clear + reset + re-attach with history replay.

## Throttling

- Tier 1 (`term.refresh`): once per 5 seconds
- Tier 2 (`refreshTerminal`): once per 30 seconds
- After successful Tier 2, reset stale detection state

## State

```typescript
let lastInputAt: number = 0;
let staleCheckTimer: number | null = null;
let staleSuspected: boolean = false;
let lastLightRefreshAt: number = 0;
let lastFullRefreshAt: number = 0;
```

## Flow

```
User types -> record lastInputAt, start 500ms timer
                    |
         Output arrives within 500ms?
           |-- YES -> clear timer, reset staleSuspected
           |-- NO  -> timer fires
                      |
                 staleSuspected already?
                   |-- NO  -> Tier 1: term.refresh(), staleSuspected = true
                   |-- YES -> Tier 2: refreshTerminal() (if >30s since last)
                              reset staleSuspected

Page becomes visible -> Tier 1: term.refresh() (if >5s since last)
```

## Scope

- All changes in `web/src/components/Terminal.svelte`
- No server-side changes
- No new protocol messages
- No heartbeat/ping overhead
- Existing `writesInFlight` safety valve unchanged
