<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { Unicode11Addon } from '@xterm/addon-unicode11';
  import { SearchAddon } from '@xterm/addon-search';
  import { ImageAddon } from '@xterm/addon-image';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import '@xterm/xterm/css/xterm.css';
  import type { SessionManager } from '../lib/SessionManager';
  import { xtermOptions, settingsStore } from '../lib/settingsStore.svelte';
  import { themeState, getTerminalTheme } from '../lib/themeStore.svelte';
  import { resizeState } from '../lib/resizeStore.svelte';
  import { TerminalResizeDebouncer } from '../lib/TerminalResizeDebouncer';
  import { getManagerContext } from '../lib/sessionContext.svelte';
  import { workspaceStore } from '../lib/workspaceStore';

  // Optional prop override (for tests that render without context).
  // Named _managerProp to avoid shadowing the `manager` local used throughout.
  let {
    _managerProp = undefined,
    activeSessionId = null,
    isActive = false,
    paneId = '',
    onSearchResults = null,
    onTitleChange = null,
  }: {
    _managerProp?: SessionManager | null;
    activeSessionId?: string | null;
    isActive?: boolean;
    paneId?: string;
    onSearchResults?: ((resultIndex: number, resultCount: number) => void) | null;
    onTitleChange?: ((title: string) => void) | null;
  } = $props();

  // Debug: unique ID for this terminal instance to track duplicates
  const terminalInstanceId = Math.random().toString(36).slice(2, 8);

  // Debug: disable WebGL for testing (can be set via URL param ?nowebgl=1)
  const disableWebGL = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nowebgl');

  const managerBox = getManagerContext();
  let manager = $derived(_managerProp !== undefined ? _managerProp : managerBox.value);

  let terminalContainer: HTMLDivElement;
  let term = $state<Terminal>();
  let fitAddon: FitAddon;
  let webglAddon: WebglAddon | null = null;
  let searchAddon: SearchAddon | null = null;
  let resizeObserver: ResizeObserver;
  let resizeDebouncer: TerminalResizeDebouncer | null = null;
  let previousSessionId: string | null = null;
  let lastCols: number = 0;

  export function getSelection(): string {
    return term?.getSelection() ?? '';
  }

  export function pasteText(text: string) {
    if (term && manager && activeSessionId && isActive) {
      manager.sendInput(activeSessionId, text);
    }
  }

  export function selectAll() {
    if (term) {
      term.selectAll();
    }
  }

  export function refreshTerminal() {
    if (term && manager && activeSessionId) {
      // Clear display and re-attach to replay history from server
      term.clear();
      term.reset();
      manager.attach(activeSessionId);
      // Scroll to bottom after history replay -- wrap in scrolledByUs to
      // prevent expensive isAtBottom() reflows in the scroll listener
      for (const delay of [200, 500, 1000]) {
        setTimeout(() => {
          if (term) {
            scrolledByUs = true;
            term.scrollToBottom();
            scrolledByUs = false;
          }
        }, delay);
      }
    }
  }

  // Decoration options for search highlighting (required for onDidChangeResults to fire)
  const searchDecorations = {
    matchBackground: '#515C6A',
    matchBorder: '#74879F',
    matchOverviewRuler: '#515C6A',
    activeMatchBackground: '#515C6A',
    activeMatchBorder: '#FFA500',
    activeMatchColorOverviewRuler: '#FFA500',
  };

  // Search addon methods for F4b integration
  export function searchFindNext(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    if (!searchAddon || !query) return false;
    return searchAddon.findNext(query, {
      caseSensitive: options?.caseSensitive,
      regex: options?.regex,
      incremental: true,
      decorations: searchDecorations,
    });
  }

  export function searchFindPrevious(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    if (!searchAddon || !query) return false;
    return searchAddon.findPrevious(query, {
      caseSensitive: options?.caseSensitive,
      regex: options?.regex,
      decorations: searchDecorations,
    });
  }

  export function searchClearDecorations(): void {
    searchAddon?.clearDecorations();
  }

  /**
   * Register a custom key event handler on the terminal.
   * Returns false from the handler to prevent the key from being sent to the terminal.
   */
  /** Force an immediate refit of the terminal to its container dimensions.
   *  Bypasses all debouncing and output-activity guards. Use for layout
   *  changes (e.g., focus/unfocus overlay) where the container size changes
   *  instantly and the terminal must catch up. */
  export function refit(): void {
    if (!term || !fitAddon) return;
    suppressResize = true; // Block ResizeObserver callbacks during layout transition
    // Double rAF ensures the browser has applied any CSS layout changes
    // (e.g., position: fixed → static) before we measure.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!term || !fitAddon) { suppressResize = false; return; }
        try {
          fitAddon.fit();
          lastCols = term.cols;
          lastRows = term.rows;
          if (manager && activeSessionId) {
            manager.resize(activeSessionId, lastCols, lastRows);
          }
          term.refresh(0, term.rows - 1);
        } catch {
          // Container may not have dimensions yet
        }
        suppressResize = false;
      });
    });
  }

  export function registerCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    if (term) {
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        // macOS-style line/word navigation:
        // Cmd+Left/Right    → beginning/end of line (Ctrl-A / Ctrl-E)
        // Option+Left/Right → word backward/forward (ESC b / ESC f)
        // Return false to prevent xterm from also sending its own sequences.
        if (event.type === 'keydown' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          let seq: string | null = null;
          if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
            seq = event.key === 'ArrowLeft' ? '\x01' : '\x05';
          } else if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            seq = event.key === 'ArrowLeft' ? '\x1bb' : '\x1bf';
          }
          if (seq && manager && activeSessionId && isActive) {
            manager.sendInput(activeSessionId, seq);
            return false;
          }
        }
        return handler(event);
      });
    }
  }
  let lastRows: number = 0;
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingFit: boolean = false;
  let lastOutputTime: number = 0;
  let isOutputActive: boolean = false;
  let outputActivityTimeout: ReturnType<typeof setTimeout> | null = null;
  let initialSizingComplete = $state(false);

  // Store bound handler reference to ensure proper cleanup
  // This fixes the listener accumulation bug where off() couldn't find the old listener
  let boundOutputHandler: ((sessionId: string, data: string) => void) | null = null;
  let currentAttachedSessionId: string | null = null;

  // Write buffer: coalesces rapid output into a single term.write() per animation frame.
  // Without this, high-throughput programs (Claude Code, cat large-file, etc.) flood
  // xterm.js with many small write() calls per frame, overwhelming the rendering pipeline
  // and causing the terminal to appear frozen or not scroll to the bottom.
  const WRITE_CHUNK_SIZE = 16 * 1024; // 16KB per term.write() call — small enough for xterm to process within its ~16ms frame budget.
                                      // TUI flicker is avoided by the burst batching logic (FLUSH_TIME_BUDGET_MS) which flushes
                                      // multiple chunks synchronously in the same frame before yielding.
  const MAX_BUFFER_SIZE = 512 * 1024; // 512KB cap to prevent unbounded memory growth (and GC pressure from large string copies)
  const MAX_WRITES_IN_FLIGHT = 2; // Cap xterm's internal queue to prevent parser saturation.
                                   // Heavy ANSI/colored output takes xterm 50-100ms+ per 16KB chunk to parse.
                                   // Without this cap, the drain loop dumps dozens of chunks in one frame,
                                   // keeping the main thread busy for hundreds of ms and freezing the UI.
  const SCROLL_THROTTLE_MS = 100; // During burst output, scroll at most every 100ms
  const FLUSH_TIME_BUDGET_MS = 8; // Max ms to spend flushing before yielding to browser
  const REFRESH_INTERVAL_MS = 200; // During sustained output, force a screen repaint every 200ms
  let writeBuffer = '';
  let writeRafId: number | null = null;
  let flushBurstStart = 0; // Timestamp of first flush in current burst
  let lastRefreshTime = 0; // Last time we forced a term.refresh() during sustained output
  let oldestWriteTime = 0; // When the first in-flight write was sent — used by watchdog to detect stuck writes
  const STUCK_WRITE_THRESHOLD_MS = 1000; // If a write has been in flight for > 1s, assume callback was lost
  // Independent screen refresh timer — runs during active output regardless of
  // write pipeline state. Without this, if term.write() callback is delayed
  // (xterm defers heavy ANSI parsing, or WebGL context loss recovery), the screen
  // freezes because the only refresh calls lived inside the write callback.
  let refreshIntervalId: ReturnType<typeof setInterval> | null = null;
  // Track number of in-flight writes to xterm (writes sent but callbacks not yet fired).
  // Used to schedule scroll-to-bottom only after all in-flight writes have been processed.
  let writesInFlight = 0;
  // Flag set synchronously around programmatic scrollToBottom() calls so the
  // scroll event listener can skip the deferred isAtBottom() check. Setting
  // scrollTop fires the scroll event synchronously, so this flag is only true
  // for exactly that event -- user scrolls (wheel, drag) are unaffected.
  let scrolledByUs = false;
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
  let lastScrollToBottomTime = 0;

  // Auto-scroll tracking: we always scroll to bottom on new output UNLESS the user
  // has explicitly scrolled up (e.g., to read earlier output). This avoids a race
  // condition where checking viewportY vs baseY per-write is unreliable during
  // xterm's async parsing -- baseY can update mid-parse while viewportY is stale,
  // causing false "not at bottom" reads that skip scrolling.
  //
  // In Svelte 5, $state is a true reactive signal that works correctly even when
  // modified inside vanilla JS callbacks (addEventListener, requestAnimationFrame,
  // Promise.then, etc.), unlike plain `let` in Svelte 4. This ensures the
  // "Scroll to bottom" badge visibility (`{#if !autoScroll}`) updates correctly
  // when autoScroll changes inside wheel/scroll/keydown event listeners.
  let autoScroll = $state(true);

  // xterm v6 uses VS Code's SmoothScrollableElement instead of native scroll
  // on .xterm-viewport. DOM scrollTop/scrollHeight are no longer reliable.
  // Use the buffer API: viewportY (top visible line) vs baseY (max scroll).
  function isAtBottom(): boolean {
    if (!term) return true;
    return term.buffer.active.viewportY >= term.buffer.active.baseY;
  }

  function initAutoScroll() {
    if (!term) return;

    // --- Mouse / trackpad ---
    // Listen on terminalContainer because xterm v6's SmoothScrollableElement
    // intercepts wheel events before they reach .xterm-viewport.
    terminalContainer.addEventListener('wheel', ((e: WheelEvent) => {
      if (e.deltaY < 0) {
        // Immediately disable auto-scroll so the next flushWriteBuffer() won't
        // call scrollToBottom() before the browser applies this wheel scroll.
        autoScroll = false;
        // After xterm processes the scroll, check if viewport is still at
        // the bottom (e.g. tiny accidental trackpad gesture). If so, re-enable.
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll = true;
        });
      } else if (e.deltaY > 0 && !autoScroll) {
        // User scrolling down -> check if reached bottom AFTER xterm applies scroll
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll = true;
        });
      }
    }) as EventListener, { passive: true });

    // --- Keyboard scroll (Shift+PageUp / Shift+PageDown) ---
    // xterm.js handles these internally; wheel events do NOT fire for them.
    // Listen in capture phase on the container so we see the key before xterm.
    terminalContainer.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!e.shiftKey) return;
      if (e.key === 'PageUp') {
        autoScroll = false;
      } else if (e.key === 'PageDown') {
        // After xterm processes the scroll, check if viewport reached bottom
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll = true;
        });
      }
    }, true);

    // --- Scrollbar drag and any other scroll source ---
    // xterm v6 fires onScroll(viewportY) for ALL scroll sources: wheel, drag,
    // touch, keyboard, programmatic. This replaces the old DOM scroll listener.
    //
    // WARNING: DO NOT add isOutputActive guards or any other conditional logic
    // here. This simple form has been broken and restored multiple times.
    // The wheel handler above already handles scroll-up/down for mouse/trackpad
    // regardless of output state. This listener must remain unconditional so
    // that scrollbar drags and touch scrolls also work during active output.
    // Adding guards (e.g. `if (isOutputActive) return`) causes scroll-up to
    // stop working while commands are running. See git history for proof.
    term.onScroll(() => {
      // Skip when we caused the scroll via our own scrollToBottom() in the write
      // callback. Those calls set scrolledByUs synchronously around the call, so
      // the flag is only true for exactly those scroll events.
      if (scrolledByUs) return;
      const atBottom = isAtBottom();
      if (atBottom && !autoScroll) {
        autoScroll = true;
      } else if (!atBottom && autoScroll) {
        autoScroll = false;
      }
    });
  }

  function bufferedWrite(data: string) {
    writeBuffer += data;
    // Cap buffer to prevent unbounded memory growth during heavy output.
    // When truncating, find a safe boundary (newline) to avoid slicing in the
    // middle of an ANSI escape sequence, which would corrupt xterm's parser
    // state and cause garbled/frozen rendering.
    if (writeBuffer.length > MAX_BUFFER_SIZE) {
      let truncated = writeBuffer.slice(-MAX_BUFFER_SIZE);
      // Find the first newline after the truncation point so we start on a
      // clean line boundary. Search only the first 4KB to avoid scanning the
      // entire buffer — if no newline is found, accept the raw slice.
      const nl = truncated.indexOf('\n', 0);
      if (nl > 0 && nl < 4096) {
        truncated = truncated.slice(nl + 1);
      }
      writeBuffer = truncated;
    }
    scheduleFlush();
  }

  function scheduleFlush() {
    if (writeRafId === null && writeBuffer && writesInFlight < MAX_WRITES_IN_FLIGHT) {
      writeRafId = requestAnimationFrame(flushWriteBuffer);
    }
  }

  function flushWriteBuffer() {
    // Reset burst timer when entering via rAF (not on recursive calls within the same frame).
    if (writeRafId !== null) flushBurstStart = performance.now();
    writeRafId = null;
    if (!writeBuffer || !term) return;

    // Drain our buffer into xterm in chunks, staying within the time budget
    // and in-flight cap. The cap prevents flooding xterm's internal queue with
    // heavy ANSI data that takes much longer to parse than plain text, which
    // would block the main thread and freeze the UI during colored output.
    while (writeBuffer && writesInFlight < MAX_WRITES_IN_FLIGHT && performance.now() - flushBurstStart < FLUSH_TIME_BUDGET_MS) {
      const chunk = writeBuffer.length <= WRITE_CHUNK_SIZE
        ? writeBuffer
        : writeBuffer.slice(0, WRITE_CHUNK_SIZE);
      writeBuffer = writeBuffer.length <= WRITE_CHUNK_SIZE
        ? ''
        : writeBuffer.slice(WRITE_CHUNK_SIZE);

      const isLastChunk = !writeBuffer;
      writesInFlight++;
      if (writesInFlight === 1) oldestWriteTime = performance.now();

      term.write(chunk, () => {
        writesInFlight--;
        if (writesInFlight === 0) oldestWriteTime = 0;

        if (!term) return;

        // Refresh / scroll coordination — only act when this is the last
        // in-flight write (all queued data has been processed by xterm).
        if (writesInFlight === 0) {
          if (!writeBuffer) {
            // All data processed — force a full repaint so the cursor and
            // final lines are visible. This MUST NOT be gated on autoScroll.
            lastRefreshTime = performance.now();
            requestAnimationFrame(() => {
              if (term) term.refresh(0, term.rows - 1);
            });
          }

          // Scroll to bottom after the last in-flight write resolves
          if (autoScroll && settingsStore.value.autoScroll) {
            scrolledByUs = true;
            term.scrollToBottom();
            scrolledByUs = false;
            lastScrollToBottomTime = Date.now();
          }
        } else {
          // Intermediate callback — periodic refresh/scroll for visual feedback
          const now = performance.now();
          if (now - lastRefreshTime >= REFRESH_INTERVAL_MS) {
            lastRefreshTime = now;
            requestAnimationFrame(() => {
              if (term) term.refresh(0, term.rows - 1);
            });
          }

          if (autoScroll && settingsStore.value.autoScroll) {
            const nowMs = Date.now();
            if (nowMs - lastScrollToBottomTime >= SCROLL_THROTTLE_MS) {
              scrolledByUs = true;
              term.scrollToBottom();
              scrolledByUs = false;
              lastScrollToBottomTime = nowMs;
            }
          }
        }

        // If new data arrived while we were processing, schedule another flush
        if (writeBuffer && writeRafId === null) {
          scheduleFlush();
        }
      });
    }

    // If buffer still has data (time budget exceeded), yield and schedule next frame
    if (writeBuffer) {
      scheduleFlush();
    }
  }

  // Minimum change in dimensions before we consider refitting
  // This prevents micro-adjustments that disrupt TUI apps
  const MIN_SIZE_CHANGE = 2;

  // How long to wait after output before marking output as inactive (ms)
  // TUI apps send rapid escape sequences - we need to let them finish
  // Set to 500ms to ensure TUI has finished rendering before any resize
  const OUTPUT_QUIET_PERIOD = 500;

  // Track last applied settings to avoid unnecessary updates
  let lastAppliedSettings: string = '';

  // Returns true if focus is currently in a non-terminal input (e.g. search bar)
  function isNonTerminalFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  }

  // Focus xterm when this pane becomes active so keyboard input works immediately.
  // Track previous value to only focus on transition to active (not on every reactive tick).
  let wasActive = false;
  $effect(() => {
    if (isActive && term && !wasActive && !isNonTerminalFocused()) {
      term.focus();
    }
    wasActive = isActive;
  });

  // Subscribe to resize state - when resize ends and we have a pending fit, do it
  $effect(() => {
    if (!resizeState.isResizing && pendingFit && term && fitAddon && resizeDebouncer) {
      pendingFit = false;
      // Wait for layout to settle after resize ends, then fit
      // Using double rAF ensures browser has completed layout calculations
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          triggerResize();
        });
      });
    }
  });

  // Mark output as active. Uses a single self-rescheduling timer instead of
  // clearing/recreating on every chunk, reducing timer churn from hundreds/sec
  // to ~2/sec under heavy output.
  function markOutputActive() {
    lastOutputTime = Date.now();

    if (!isOutputActive) {
      isOutputActive = true;
      if (resizeDebouncer) {
        resizeDebouncer.setOutputActive(true);
      }
      // Start independent screen refresh timer. This runs outside the write
      // pipeline so the screen stays live even when term.write() callback is
      // delayed (heavy ANSI parsing deferral, WebGL context loss recovery).
      if (!refreshIntervalId) {
        refreshIntervalId = setInterval(() => {
          if (!term) return;
          term.refresh(0, term.rows - 1);
          // Watchdog: detect stuck writesInFlight during active output.
          // If write callbacks haven't fired for > 1s (lost due to WebGL context
          // loss or parser error), reset the counter so new data can flow.
          // Without this, the write pipeline deadlocks: scheduleFlush() can't fire
          // because writesInFlight >= MAX, and the safety valve in checkQuiet()
          // never triggers because output keeps arriving (lastOutputTime stays fresh).
          if (writesInFlight > 0 && oldestWriteTime > 0 &&
              performance.now() - oldestWriteTime > STUCK_WRITE_THRESHOLD_MS && writeBuffer) {
            console.warn(`[Terminal:${terminalInstanceId}] Watchdog: writesInFlight=${writesInFlight} stuck for ${Math.round(performance.now() - oldestWriteTime)}ms during active output, resetting`);
            writesInFlight = 0;
            oldestWriteTime = 0;
            scheduleFlush();
          }
        }, REFRESH_INTERVAL_MS);
      }
    }

    // Only create the timer once; it self-reschedules while output is active
    if (!outputActivityTimeout) {
      outputActivityTimeout = setTimeout(function checkQuiet() {
        if (Date.now() - lastOutputTime >= OUTPUT_QUIET_PERIOD) {
          isOutputActive = false;
          if (resizeDebouncer) {
            resizeDebouncer.setOutputActive(false);
          }
          // Stop independent refresh timer — output has settled
          if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
          }

          // Safety valve: if writesInFlight is stuck (xterm dropped a
          // callback during WebGL context loss or parser error), reset
          // it so future writes can trigger the final refresh + scroll.
          if (writesInFlight > 0 && term) {
            console.warn(`[Terminal:${terminalInstanceId}] Output quiet but writesInFlight=${writesInFlight} stuck, resetting`);
            writesInFlight = 0;
            oldestWriteTime = 0;
            requestAnimationFrame(() => {
              if (term) {
                term.refresh(0, term.rows - 1);
                if (autoScroll && settingsStore.value.autoScroll) {
                  scrolledByUs = true;
                  term.scrollToBottom();
                  scrolledByUs = false;
                }
              }
            });
          }

          outputActivityTimeout = null;
        } else {
          // Still active -- check again later
          outputActivityTimeout = setTimeout(checkQuiet, OUTPUT_QUIET_PERIOD);
        }
      }, OUTPUT_QUIET_PERIOD);
    }
  }

  // Get proposed dimensions from fit addon - no column limiting
  // We want this to work like VS Code - any width should render properly
  function getProposedDimensions(): { cols: number; rows: number } | null {
    if (!fitAddon) return null;

    const dims = fitAddon.proposeDimensions();
    if (!dims) return null;

    return {
      cols: dims.cols,
      rows: dims.rows
    };
  }

  // Trigger resize through debouncer
  function triggerResize(immediate = false) {
    if (!resizeDebouncer) return;

    const dims = getProposedDimensions();
    if (!dims) return;

    // Skip if dimensions haven't changed significantly (unless immediate)
    if (!immediate) {
      const colChange = Math.abs(dims.cols - lastCols);
      const rowChange = Math.abs(dims.rows - lastRows);
      if (colChange < MIN_SIZE_CHANGE && rowChange < MIN_SIZE_CHANGE) {
        return;
      }
    }

    resizeDebouncer.resize(dims.cols, dims.rows, immediate);
  }

  // trimPartialRow was removed: fitAddon.fit() may allocate a partial extra
  // row when the container height doesn't divide evenly by cell height.
  // Previously we trimmed the row (term.resize to rows-1) but this created
  // inconsistent bottom gaps across panes. Instead, we let the partial row
  // render and clip it via CSS (overflow: hidden on .xterm), which is visually
  // seamless -- the partial row is simply not visible.

  // When refit() is handling a layout change (e.g., focus/unfocus overlay),
  // suppress ResizeObserver callbacks to avoid racing with xterm's rendering.
  // refit() uses double-rAF to wait for CSS layout to settle before measuring.
  let suppressResize = false;

  // Guard to prevent fitAddon.fit() from re-triggering ResizeObserver loop.
  // When a resize arrives while one is in-flight, we queue it instead of
  // dropping it — this prevents frozen/garbled displays when the container
  // changes size rapidly (e.g., focus/unfocus overlay toggling position: fixed).
  let isApplyingResize = false;
  let pendingResizeArgs: { cols: number; rows: number } | null = null;

  // Apply resize to terminal and PTY
  function applyResize(cols: number, rows: number) {
    if (!term) return;

    if (isApplyingResize) {
      // Queue instead of dropping — the queued resize fires after the
      // current one completes (see the setTimeout below).
      pendingResizeArgs = { cols, rows };
      return;
    }

    isApplyingResize = true;

    try {
      // Use fitAddon.fit() instead of manual term.resize().
      // fitAddon.fit() measures the actual container, resizes the terminal,
      // AND properly updates the viewport's scroll range. Manual term.resize()
      // reflows the buffer but can leave the viewport scrollHeight stale,
      // preventing users from scrolling to the end of long output.
      fitAddon.fit();

      lastCols = term.cols;
      lastRows = term.rows;
    } catch {
      // fitAddon.fit() can fail if container has no dimensions yet
      term.resize(cols, rows);
      lastCols = cols;
      lastRows = rows;
    }

    // Sync PTY dimensions - sends SIGWINCH to the running app
    if (manager && activeSessionId) {
      manager.resize(activeSessionId, lastCols, lastRows);
    }

    // Immediate repaint after reflow so the screen isn't stale/garbled
    // during the 100ms gap before the deferred scroll + refresh below.
    term.refresh(0, term.rows - 1);

    // Auto-scroll to bottom after resize so user sees latest output.
    // xterm.js has its own internal render cycle that may not complete within
    // a single requestAnimationFrame. Use setTimeout to give xterm time to
    // finish rendering after the reflow, then scroll to bottom.
    // Keep isApplyingResize=true until after scroll to prevent ResizeObserver
    // re-entry from fitAddon.fit() DOM changes resetting scroll position.
    setTimeout(() => {
      if (autoScroll && settingsStore.value.autoScroll && term) {
        scrolledByUs = true;
        term.scrollToBottom();
        scrolledByUs = false;
      }
      // Force a full repaint so the screen isn't stale after reflow
      if (term) term.refresh(0, term.rows - 1);
      isApplyingResize = false;

      // Drain queued resize (e.g., unfocus arrived while focus resize was in-flight)
      if (pendingResizeArgs) {
        const queued = pendingResizeArgs;
        pendingResizeArgs = null;
        applyResize(queued.cols, queued.rows);
      }
    }, 100);
  }

  // Resolve per-pane terminal theme (falls back to global if no override)
  let paneTheme = $derived((() => {
    // Access themeState.value so this re-evaluates when overrides change
    void themeState.value;
    return getTerminalTheme(paneId);
  })());

  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Merge layout settings from xtermOptions with per-pane theme
  let resolvedOptions = $derived(xtermOptions.value && paneTheme ? {
    ...xtermOptions.value,
    theme: {
      foreground: paneTheme.foreground,
      background: paneTheme.background,
      cursor: paneTheme.cursor,
      cursorAccent: paneTheme.cursorAccent,
      selectionBackground: paneTheme.selectionBackground,
      selectionForeground: paneTheme.selectionForeground,
      selectionInactiveBackground: paneTheme.selectionInactiveBackground,
      ...paneTheme.ansi,
    },
  } : xtermOptions.value);

  // Subscribe to settings changes and apply to terminal
  // Only apply if terminal is fully initialized and settings actually changed
  $effect(() => {
    if (term && term.options && resolvedOptions) {
      const settingsKey = JSON.stringify(resolvedOptions);
      if (settingsKey !== lastAppliedSettings) {
          lastAppliedSettings = settingsKey;
          applySettings(resolvedOptions);
      }
    }
  });

  function applySettings(options: typeof xtermOptions.value) {
      // Guard against uninitialized terminal
      if (!term || !term.options) return;

      // Track if we need to refit (only for size-related changes)
      const needsRefit =
          term.options.fontSize !== options.fontSize ||
          term.options.fontFamily !== options.fontFamily;

      // Apply individual options that can be changed after initialization
      term.options.fontSize = options.fontSize;
      term.options.fontFamily = options.fontFamily;
      term.options.cursorStyle = options.cursorStyle;
      term.options.cursorBlink = options.cursorBlink;
      // Note: lineHeight changes can break TUI apps (Claude Code, vim, etc.)
      // Only apply on initialization, not reactively
      // term.options.lineHeight = options.lineHeight;
      term.options.theme = options.theme;

      // Only refit if font size/family changed to minimize redraws
      if (needsRefit && fitAddon && resizeDebouncer) {
          // Use immediate resize for settings changes
          triggerResize(true);
      }
  }

  // Cleanup output listener - must use stored reference
  function cleanupOutputListener() {
      if (manager && boundOutputHandler) {
          console.log(`[Terminal:${terminalInstanceId}] Removing output listener for session ${currentAttachedSessionId?.slice(0, 8)}`);
          manager.off('output', boundOutputHandler);
          boundOutputHandler = null;
          currentAttachedSessionId = null;
      }
  }

  // Setup output listener - stores reference for proper cleanup
  function setupOutputListener(mgr: SessionManager, sessionId: string) {
      // First cleanup any existing listener
      cleanupOutputListener();

      // Debug: Check how many listeners are on the manager
      const listenerCount = mgr.listenerCount?.('output') ?? 'unknown';
      console.log(`[Terminal:${terminalInstanceId}] Setting up listener. Current output listeners: ${listenerCount}`);

      // Create bound handler that captures the sessionId.
      // Uses bufferedWrite to coalesce rapid output into fewer term.write() calls.
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

      boundOutputHandler = handler;
      currentAttachedSessionId = sessionId;
      mgr.on('output', handler);

      const newListenerCount = mgr.listenerCount?.('output') ?? 'unknown';
      console.log(`[Terminal:${terminalInstanceId}] Added output listener for session ${sessionId.slice(0, 8)}. Total: ${newListenerCount}`);
  }

  // Reactivity for manager events and session changes
  // Wait for initial sizing to complete before attaching to sessions
  $effect(() => {
    if (manager && activeSessionId && term && initialSizingComplete) {
      // Only re-setup if session actually changed
      if (currentAttachedSessionId !== activeSessionId) {
          console.log(`[Terminal:${terminalInstanceId}] Session changed from ${currentAttachedSessionId?.slice(0, 8)} to ${activeSessionId.slice(0, 8)}`);

          // Setup new listener (this also cleans up old one)
          setupOutputListener(manager, activeSessionId);

          // Clear terminal and attach to new session when switching
          if (previousSessionId !== activeSessionId) {
              term.clear();
              term.reset();
              previousSessionId = activeSessionId;

              // CRITICAL: Send resize BEFORE attach to ensure PTY has correct dimensions
              // when output starts flowing. This prevents wide terminal rendering issues.
              if (lastCols > 0 && lastRows > 0) {
                  manager.resize(activeSessionId, lastCols, lastRows);
              }

              // Wait for resize to propagate through WebSocket -> server -> PTY -> SIGWINCH
              // before attaching (which replays history). 150ms accounts for network + processing.
              setTimeout(() => {
                  if (manager && activeSessionId) {
                      manager.attach(activeSessionId);
                      // After attach replays history, scroll to bottom so user sees latest output.
                      // History replay streams data over WebSocket in chunks. We scroll multiple
                      // times with increasing delays to handle both small and large histories.
                      // Wrap in scrolledByUs to prevent isAtBottom() reflows.
                      for (const delay of [200, 500, 1000]) {
                          setTimeout(() => {
                              if (term) {
                                  scrolledByUs = true;
                                  term.scrollToBottom();
                                  scrolledByUs = false;
                              }
                          }, delay);
                      }
                  }
              }, 150);
          }
      }
    }
  });

  onMount(() => {
    console.log(`[Terminal:${terminalInstanceId}] onMount called for session ${activeSessionId?.slice(0, 8)}`);
    // Get initial settings from store
    const initialOptions = xtermOptions.value;

    term = new Terminal({
      cursorBlink: initialOptions.cursorBlink,
      cursorStyle: initialOptions.cursorStyle,
      fontSize: initialOptions.fontSize,
      fontFamily: initialOptions.fontFamily,
      // Force lineHeight to 1.0 - other values break TUI apps (vim, Claude Code, etc.)
      lineHeight: 1.0,
      theme: initialOptions.theme,
      // Settings for better TUI app compatibility
      allowProposedApi: true,
      scrollback: 10000,
      // Note: scrollOnOutput was removed in xterm.js 5.x (silently ignored).
      // xterm 5.x does NOT auto-scroll on new output. We scroll to bottom
      // ourselves in flushWriteBuffer(), gated by the autoScroll flag.
      // Ensure proper text measurement and rendering
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      // Disable some features that can cause rendering issues
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Load Unicode11 addon for proper wide character / emoji rendering.
    // Without this, multi-byte Unicode characters (emoji, CJK, special symbols)
    // may render as question marks or with wrong widths.
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    // Load Search addon for Ctrl-F search in scrollback (F4b)
    searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      if (onSearchResults) {
        // resultIndex is 0-based, convert to 1-based for display
        onSearchResults(resultIndex >= 0 ? resultIndex + 1 : 0, resultCount);
      }
    });

    // Load Web Links addon for clickable HTTP/HTTPS URLs.
    // Cmd+Click (macOS) or Ctrl+Click (other) opens in system browser.
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (isMac ? event.metaKey : event.ctrlKey) {
        window.open(uri, '_blank', 'noopener,noreferrer');
      }
    });
    term.loadAddon(webLinksAddon);

    term.open(terminalContainer);

    // Listen for terminal title changes (OSC 2 escape sequences from apps like Claude, Gemini)
    // Must be after term.open() so the parser is initialized
    if (term.onTitleChange) {
      term.onTitleChange((title) => {
        if (onTitleChange) onTitleChange(title);
      });
    }

    // Setup auto-scroll tracking (needs viewport DOM element from term.open)
    initAutoScroll();

    // Handle alternate buffer -> normal buffer switches (TUI app exit).
    // When a full-screen TUI (vim, Claude Code /config, etc.) exits, xterm.js
    // switches from alternate buffer back to normal buffer and restores the
    // viewport to its pre-TUI scroll position. This fires a scroll event that
    // our scroll listener would interpret as "user scrolled up", permanently
    // disabling autoScroll. Fix: suppress the scroll listener during the switch
    // and force scroll-to-bottom so the user sees the prompt after TUI exit.
    if (term.buffer.onBufferChange) {
      term.buffer.onBufferChange(() => {
        console.log(`[Terminal:${terminalInstanceId}] Buffer change to: ${term.buffer.active.type}, writesInFlight=${writesInFlight}, buffer=${writeBuffer.length}B`);
        if (term.buffer.active.type === 'normal') {
          autoScroll = true;
          // Defer scrollToBottom to next frame to ensure xterm has finished
          // all viewport updates from the buffer switch
          requestAnimationFrame(() => {
            if (term) {
              scrolledByUs = true;
              term.scrollToBottom();
              scrolledByUs = false;
            }
          });
        }
      });
    }

    // Load WebGL addon for GPU-accelerated rendering
    // This dramatically improves performance for wide terminals
    if (!disableWebGL) {
      try {
        webglAddon = new WebglAddon();

        // Handle WebGL context loss - browser may drop it under GPU memory
        // pressure (common during heavy colored output with many draw calls).
        // After disposal, xterm falls back to the DOM renderer, but the DOM rows
        // are stale — we must force a full repaint so the screen doesn't appear
        // frozen with a missing cursor.
        webglAddon.onContextLoss(() => {
          console.warn(`[Terminal:${terminalInstanceId}] WebGL context lost! writesInFlight=${writesInFlight}, buffer=${writeBuffer.length}B`);
          webglAddon?.dispose();
          webglAddon = null;

          // Reset writesInFlight: pending write callbacks from the disposed
          // WebGL renderer will never fire. Without this reset, the
          // writesInFlight === 0 gate in flushWriteBuffer's callback blocks
          // the final refresh + scrollToBottom forever.
          writesInFlight = 0;
          oldestWriteTime = 0;

          // Schedule multiple refreshes with increasing delays. The DOM
          // renderer needs time to fully initialize after WebGL disposal.
          // A single rAF is insufficient — the first repaint often fires
          // before the DOM renderer has created its row elements.
          // Using setTimeout instead of rAF because rAF can be throttled
          // by the browser after a GPU context loss event.
          for (const delay of [0, 50, 150, 500]) {
            setTimeout(() => {
              if (term) term.refresh(0, term.rows - 1);
            }, delay);
          }
        });

        term.loadAddon(webglAddon);
        console.log('[Terminal] WebGL renderer enabled');
      } catch (e) {
        console.warn('[Terminal] WebGL not available, using DOM renderer:', e);
        webglAddon = null;
      }
    } else {
      console.log('[Terminal] WebGL disabled via URL parameter');
    }

    // Image display (SIXEL + iTerm2 IIP)
    const imageAddon = new ImageAddon();
    term.loadAddon(imageAddon);

    // Create resize debouncer
    resizeDebouncer = new TerminalResizeDebouncer(
      () => term,
      applyResize
    );

    // Initial sizing: use fitAddon to calculate actual container dimensions
    // immediately rather than hardcoding 80x24 which causes garbled output
    // when the actual container is wider (e.g., Claude Code rendering issues).
    try {
      fitAddon.fit();

      lastCols = term.cols;
      lastRows = term.rows;
      initialSizingComplete = true;
      console.log(`[Terminal:${terminalInstanceId}] Initial sizing complete: ${lastCols}x${lastRows}`);
    } catch {
      // fitAddon.fit() can fail if container has no dimensions yet (e.g., hidden tab).
      // Fall back to rAF to get dimensions after layout.
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();

        } catch {
          // Still no dimensions -- will be corrected by ResizeObserver
        }
        lastCols = term.cols;
        lastRows = term.rows;
        initialSizingComplete = true;
        console.log(`[Terminal:${terminalInstanceId}] Initial sizing complete (deferred): ${lastCols}x${lastRows}`);
      });
    }

    // Shift+Enter -> CSI u encoding (\x1b[13;2u) per the fixterms/CSI u protocol.
    // This is the same behavior as iTerm2, Kitty, WezTerm, and Ghostty.
    // Apps like Claude Code recognize this as "insert newline" vs Enter (submit).
    // Regular shells ignore unknown CSI sequences harmlessly.
    // Uses DOM capture listener so preventDefault() fully suppresses the browser's
    // default handling (inserting \r into xterm's hidden textarea).
    terminalContainer.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (manager && activeSessionId && isActive) {
          manager.sendInput(activeSessionId, '\x1b[13;2u');
        }
      }
    }, true); // capture phase -- fires before xterm's own handler

    // Option+Click to position cursor on the current line (like iTerm2).
    // For shells (no mouse tracking): calculates column delta and sends arrow keys.
    // For TUI apps (mouse tracking enabled): re-dispatches as a plain click so
    // the app handles cursor positioning via its own mouse event handler.
    let optClickSynthetic = false;
    terminalContainer.addEventListener('mousedown', (e: MouseEvent) => {
      if (optClickSynthetic) return; // let synthetic events pass through
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (!term || !manager || !activeSessionId || !isActive) return;

      // TUI app with mouse tracking: strip Alt and re-dispatch as plain click
      console.log('[OPT-CLICK] mouseTracking:', term.modes.mouseTrackingMode);
      if (term.modes.mouseTrackingMode !== 'none') {
        e.preventDefault();
        e.stopPropagation();
        optClickSynthetic = true;
        terminalContainer.dispatchEvent(new MouseEvent('mousedown', {
          clientX: e.clientX, clientY: e.clientY,
          button: e.button, buttons: e.buttons,
          bubbles: true, cancelable: true,
        }));
        optClickSynthetic = false;
        return;
      }

      if (!isAtBottom()) return;

      const screen = term.element?.querySelector('.xterm-screen');
      if (!screen) return;
      const rect = screen.getBoundingClientRect();
      const cellWidth = rect.width / term.cols;
      const cellHeight = rect.height / term.rows;
      const clickCol = Math.min(Math.floor((e.clientX - rect.left) / cellWidth), term.cols - 1);
      const clickRow = Math.floor((e.clientY - rect.top) / cellHeight);

      if (clickRow !== term.buffer.active.cursorY) return;

      const delta = clickCol - term.buffer.active.cursorX;
      if (delta === 0) return;

      e.preventDefault();
      e.stopPropagation();
      term.focus();

      const seq = delta > 0
        ? '\x1b[C'.repeat(delta)
        : '\x1b[D'.repeat(-delta);
      manager.sendInput(activeSessionId, seq);
    }, true);

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
            // Clear the "new" badge on the first real user input
            if (workspaceStore.isSessionNew(activeSessionId)) {
                workspaceStore.clearSessionNew(activeSessionId);
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

    // Handle container resize
    function handleResize() {
      // refit() is handling a layout transition (e.g., focus/unfocus overlay) —
      // it uses double-rAF to wait for CSS layout, so skip ResizeObserver noise.
      if (suppressResize) return;

      // If actively resizing (drag), defer until resize ends
      if (resizeState.isResizing) {
        pendingFit = true;
        return;
      }

      // If output is active, be more conservative
      if (isOutputActive) {
        // Schedule retry after output settles
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          triggerResize();
        }, OUTPUT_QUIET_PERIOD + 50);
        return;
      }

      triggerResize();
    }

    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalContainer);

    // Re-focus terminal after scrolling so keyboard input continues working.
    // xterm v6 uses SmoothScrollableElement -- listen on the container.
    scrollEndHandler = () => {
      if (isActive && term && !isNonTerminalFocused()) {
        term.focus();
      }
    };
    terminalContainer.addEventListener('scrollend', scrollEndHandler);
    // Fallback: also re-focus on mouseup after a scroll drag
    terminalContainer.addEventListener('mouseup', scrollEndHandler);

    // Handle window resize
    windowResizeHandler = handleResize;
    window.addEventListener('resize', windowResizeHandler);

    // Handle visibility changes (tab switching, minimizing, etc.)
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now();
      } else if (document.visibilityState === 'visible') {
        // Full recovery after extended hidden period (lock screen, sleep).
        // Tab switches are typically <5 s so they skip the expensive re-attach.
        if (hiddenSince && (Date.now() - hiddenSince) > 5000) {
          console.log(`[Terminal:${terminalInstanceId}] Visibility restored after ${Date.now() - hiddenSince}ms — running full refreshTerminal()`);
          refreshTerminal();
        }
        hiddenSince = null;

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
            oldestWriteTime = 0;
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

        // Also flush pending resize and recalculate dimensions
        if (resizeDebouncer) {
          resizeDebouncer.flush();
          requestAnimationFrame(() => {
            triggerResize(true);
          });
        }
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    // Store initial dimensions
    lastCols = term.cols;
    lastRows = term.rows;
  });

  let windowResizeHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;
  let scrollEndHandler: (() => void) | null = null;
  let hiddenSince: number | null = null;

  onDestroy(() => {
    console.log(`[Terminal:${terminalInstanceId}] Destroying terminal component. Session: ${currentAttachedSessionId?.slice(0, 8)}`);
    if (writeRafId !== null) cancelAnimationFrame(writeRafId);
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    writeBuffer = '';
    writesInFlight = 0;
    oldestWriteTime = 0;
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (outputActivityTimeout) clearTimeout(outputActivityTimeout);
    if (staleCheckTimer) clearTimeout(staleCheckTimer);
    if (resizeDebouncer) resizeDebouncer.dispose();
    if (searchAddon) searchAddon.dispose();
    if (webglAddon) webglAddon.dispose();
    if (term) term.dispose();
    if (resizeObserver) resizeObserver.disconnect();
    // Use new cleanup function to properly remove listener
    cleanupOutputListener();
    if (scrollEndHandler && terminalContainer) {
      terminalContainer.removeEventListener('scrollend', scrollEndHandler);
      terminalContainer.removeEventListener('mouseup', scrollEndHandler);
    }
    if (windowResizeHandler) {
      window.removeEventListener('resize', windowResizeHandler);
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
    }
    // Debug: Check remaining listeners after cleanup
    if (manager) {
      const remainingListeners = manager.listenerCount?.('output') ?? 'unknown';
      console.log(`[Terminal:${terminalInstanceId}] After cleanup, remaining output listeners: ${remainingListeners}`);
    }
  });
</script>

<div class="terminal-wrapper">
  <div class="terminal-margins" style:background-color={resolvedOptions?.theme?.background}>
    <div class="terminal-container" bind:this={terminalContainer} onmousedown={() => { if (term) term.focus(); }}
      style:--scrollbar-bg={paneTheme ? hexToRgba(paneTheme.foreground, 0.2) : undefined}
      style:--scrollbar-bg-hover={paneTheme ? hexToRgba(paneTheme.foreground, 0.4) : undefined}
      style:--scrollbar-bg-active={paneTheme ? hexToRgba(paneTheme.foreground, 0.5) : undefined}
    ></div>
  </div>
  <button
    class="scroll-to-bottom-badge"
    class:visible={!autoScroll}
    onclick={() => { autoScroll = true; if (term) { scrolledByUs = true; term.scrollToBottom(); scrolledByUs = false; } }}
  >
    Scroll to bottom
  </button>
</div>

<style>
  .terminal-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .terminal-margins {
    width: 100%;
    height: 100%;
    padding: 4px 0 0 6px;
    box-sizing: border-box;
  }

  .terminal-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .scroll-to-bottom-badge {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    background: var(--ui-bg-secondary, #181a1c);
    color: var(--ui-text-muted, #757578);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 12px;
    padding: 4px 14px;
    font-size: 12px;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .scroll-to-bottom-badge.visible {
    opacity: 0.85;
    pointer-events: auto;
  }

  .scroll-to-bottom-badge.visible:hover {
    opacity: 1;
    color: var(--ui-text, #fdfbfe);
  }

  /* Ensure xterm takes full space and clips partial rows at the bottom.
     fitAddon.fit() may allocate a partial extra row when the container height
     doesn't divide evenly by cell height -- overflow:hidden clips it seamlessly. */
  .terminal-container :global(.xterm) {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* Fix bottom gap: xterm.css hardcodes viewport bg to #000 which
     doesn't match the terminal theme. Inherit from container instead.
     Also hide native scrollbar — xterm v6 uses SmoothScrollableElement
     for scrolling with its own custom scrollbar. The native scrollbar
     leaks through in the partial-row gap area. */
  .terminal-container :global(.xterm-viewport) {
    background-color: inherit !important;
    scrollbar-width: none;
  }

  .terminal-container :global(.xterm-viewport::-webkit-scrollbar) {
    width: 0;
    height: 0;
  }

  /* xterm v6 uses VS Code's SmoothScrollableElement with class .xterm-scrollable-element.
     The old .xterm-viewport native scrollbar is no longer used for scrolling.
     xterm bakes scrollbar colors into a <style> at init and doesn't update on theme
     changes, so we override via CSS custom properties set on .terminal-container. */
  .terminal-container :global(.xterm-scrollable-element > .scrollbar > .slider) {
    border-radius: 5px;
    background: var(--scrollbar-bg) !important;
  }
  .terminal-container :global(.xterm-scrollable-element > .scrollbar > .slider:hover) {
    background: var(--scrollbar-bg-hover) !important;
  }
  .terminal-container :global(.xterm-scrollable-element > .scrollbar > .slider.active) {
    background: var(--scrollbar-bg-active) !important;
  }
</style>
