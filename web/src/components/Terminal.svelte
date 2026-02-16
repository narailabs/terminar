<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { Unicode11Addon } from 'xterm-addon-unicode11';
  import { SearchAddon } from 'xterm-addon-search';
  import 'xterm/css/xterm.css';
  import type { SessionManager } from '../lib/SessionManager';
  import { xtermOptions, settingsStore } from '../lib/settingsStore';
  import { themeState, getTerminalTheme } from '../lib/themeStore';
  import { isResizing } from '../lib/resizeStore';
  import { TerminalResizeDebouncer } from '../lib/TerminalResizeDebouncer';
  import { getManagerContext } from '../lib/sessionContext';

  // Optional prop override (for tests that render without context).
  // Named _managerProp to avoid shadowing the `manager` local used throughout.
  export let _managerProp: SessionManager | null | undefined = undefined;

  const managerStore = getManagerContext();
  let manager: SessionManager | null;
  $: manager = _managerProp !== undefined ? _managerProp : $managerStore;

  export let activeSessionId: string | null = null;
  export let isActive: boolean = false; // Only send input when active pane - default to false for safety
  export let paneId: string = '';
  export let onSearchResults: ((resultIndex: number, resultCount: number) => void) | null = null;

  // Debug: unique ID for this terminal instance to track duplicates
  const terminalInstanceId = Math.random().toString(36).slice(2, 8);

  // Debug: disable WebGL for testing (can be set via URL param ?nowebgl=1)
  const disableWebGL = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nowebgl');

  let terminalContainer: HTMLDivElement;
  let term: Terminal;
  let fitAddon: FitAddon;
  let webglAddon: WebglAddon | null = null;
  let searchAddon: SearchAddon | null = null;
  let resizeObserver: ResizeObserver;
  let resizeDebouncer: TerminalResizeDebouncer | null = null;
  let previousSessionId: string | null = null;
  export let lastCols: number = 0;

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
      // Scroll to bottom after history replay
      for (const delay of [200, 500, 1000]) {
        setTimeout(() => {
          if (term) term.scrollToBottom();
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
  export function registerCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    if (term) {
      term.attachCustomKeyEventHandler(handler);
    }
  }
  export let lastRows: number = 0;
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingFit: boolean = false;
  let lastOutputTime: number = 0;
  let isOutputActive: boolean = false;
  let outputActivityTimeout: ReturnType<typeof setTimeout> | null = null;
  let initialSizingComplete: boolean = false;

  // Store bound handler reference to ensure proper cleanup
  // This fixes the listener accumulation bug where off() couldn't find the old listener
  let boundOutputHandler: ((sessionId: string, data: string) => void) | null = null;
  let currentAttachedSessionId: string | null = null;

  // Write buffer: coalesces rapid output into a single term.write() per animation frame.
  // Without this, high-throughput programs (Claude Code, cat large-file, etc.) flood
  // xterm.js with many small write() calls per frame, overwhelming the rendering pipeline
  // and causing the terminal to appear frozen or not scroll to the bottom.
  let writeBuffer = '';
  let writeRafId: number | null = null;

  // Auto-scroll tracking: we always scroll to bottom on new output UNLESS the user
  // has explicitly scrolled up (e.g., to read earlier output). This avoids a race
  // condition where checking viewportY vs baseY per-write is unreliable during
  // xterm's async parsing — baseY can update mid-parse while viewportY is stale,
  // causing false "not at bottom" reads that skip scrolling.
  const autoScroll = writable(true);
  let viewportElement: Element | null = null;

  // Threshold (px) for "close enough to bottom" — covers sub-pixel rounding.
  const BOTTOM_THRESHOLD = 5;

  function isAtBottom(): boolean {
    if (!viewportElement) return true;
    const el = viewportElement as HTMLElement;
    return el.scrollTop >= el.scrollHeight - el.clientHeight - BOTTOM_THRESHOLD;
  }

  function initAutoScroll() {
    viewportElement = terminalContainer?.querySelector('.xterm-viewport');
    if (!viewportElement) return;

    // --- Mouse / trackpad ---
    viewportElement.addEventListener('wheel', ((e: WheelEvent) => {
      if (e.deltaY < 0) {
        // Immediately disable auto-scroll so the next flushWriteBuffer() won't
        // call scrollToBottom() before the browser applies this wheel scroll.
        autoScroll.set(false);
        // After the browser applies the scroll, check if viewport is still at
        // the bottom (e.g. tiny accidental trackpad gesture). If so, re-enable.
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll.set(true);
        });
      } else if (e.deltaY > 0 && !$autoScroll) {
        // User scrolling down → check if reached bottom AFTER browser applies scroll
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll.set(true);
        });
      }
    }) as EventListener, { passive: true });

    // --- Keyboard scroll (Shift+PageUp / Shift+PageDown) ---
    // xterm.js handles these internally; wheel events do NOT fire for them.
    // Listen in capture phase on the container so we see the key before xterm.
    terminalContainer.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!e.shiftKey) return;
      if (e.key === 'PageUp') {
        autoScroll.set(false);
      } else if (e.key === 'PageDown') {
        // After xterm processes the scroll, check if viewport reached bottom
        requestAnimationFrame(() => {
          if (isAtBottom()) autoScroll.set(true);
        });
      }
    }, true);

    // --- Scrollbar drag and any other scroll source ---
    // Covers cases not caught by wheel/keydown (e.g. scrollbar drag, touch).
    viewportElement.addEventListener('scroll', () => {
      if (isAtBottom()) {
        autoScroll.set(true);
      } else {
        autoScroll.set(false);
      }
    }, { passive: true });
  }

  function bufferedWrite(data: string) {
    writeBuffer += data;
    if (writeRafId === null) {
      writeRafId = requestAnimationFrame(flushWriteBuffer);
    }
  }

  function flushWriteBuffer() {
    writeRafId = null;
    if (!writeBuffer || !term) return;

    const data = writeBuffer;
    writeBuffer = '';

    term.write(data, () => {
      if ($autoScroll && $settingsStore.autoScroll && term) {
        term.scrollToBottom();
      }
    });
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
  $: if (isActive && term && !wasActive && !isNonTerminalFocused()) {
    term.focus();
  }
  $: wasActive = isActive;

  // Subscribe to resize state - when resize ends and we have a pending fit, do it
  $: if (!$isResizing && pendingFit && term && fitAddon && resizeDebouncer) {
    pendingFit = false;
    // Wait for layout to settle after resize ends, then fit
    // Using double rAF ensures browser has completed layout calculations
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        triggerResize();
      });
    });
  }

  // Mark output as active and schedule inactive marking
  function markOutputActive() {
    lastOutputTime = Date.now();
    isOutputActive = true;

    // Notify debouncer of output activity
    if (resizeDebouncer) {
      resizeDebouncer.setOutputActive(true);
    }

    if (outputActivityTimeout) {
      clearTimeout(outputActivityTimeout);
    }

    outputActivityTimeout = setTimeout(() => {
      isOutputActive = false;
      // Notify debouncer that output has settled
      if (resizeDebouncer) {
        resizeDebouncer.setOutputActive(false);
      }
      outputActivityTimeout = null;
    }, OUTPUT_QUIET_PERIOD);
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

  // Guard to prevent fitAddon.fit() from re-triggering ResizeObserver loop
  let isApplyingResize = false;

  // Apply resize to terminal and PTY
  function applyResize(cols: number, rows: number) {
    if (!term || isApplyingResize) return;

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

    // Auto-scroll to bottom after resize so user sees latest output.
    // xterm.js has its own internal render cycle that may not complete within
    // a single requestAnimationFrame. Use setTimeout to give xterm time to
    // finish rendering after the reflow, then scroll to bottom.
    // Keep isApplyingResize=true until after scroll to prevent ResizeObserver
    // re-entry from fitAddon.fit() DOM changes resetting scroll position.
    setTimeout(() => {
      if ($autoScroll && $settingsStore.autoScroll && term) {
        term.scrollToBottom();
      }
      isApplyingResize = false;
    }, 100);
  }

  // Resolve per-pane terminal theme (falls back to global if no override)
  $: paneTheme = (() => {
    // Subscribe to themeState so this re-evaluates when overrides change
    void $themeState;
    return getTerminalTheme(paneId);
  })();

  // Merge layout settings from xtermOptions with per-pane theme
  $: resolvedOptions = $xtermOptions && paneTheme ? {
    ...$xtermOptions,
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
  } : $xtermOptions;

  // Subscribe to settings changes and apply to terminal
  // Only apply if terminal is fully initialized and settings actually changed
  $: if (term && term.options && resolvedOptions) {
      const settingsKey = JSON.stringify(resolvedOptions);
      if (settingsKey !== lastAppliedSettings) {
          lastAppliedSettings = settingsKey;
          applySettings(resolvedOptions);
      }
  }

  function applySettings(options: typeof $xtermOptions) {
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
  $: if (manager && activeSessionId && term && initialSizingComplete) {
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

              // Wait for resize to propagate through WebSocket → server → PTY → SIGWINCH
              // before attaching (which replays history). 150ms accounts for network + processing.
              setTimeout(() => {
                  if (manager && activeSessionId) {
                      manager.attach(activeSessionId);
                      // After attach replays history, scroll to bottom so user sees latest output.
                      // History replay streams data over WebSocket in chunks. We scroll multiple
                      // times with increasing delays to handle both small and large histories.
                      for (const delay of [200, 500, 1000]) {
                          setTimeout(() => {
                              if (term) term.scrollToBottom();
                          }, delay);
                      }
                  }
              }, 150);
          }
      }
  }

  onMount(() => {
    console.log(`[Terminal:${terminalInstanceId}] onMount called for session ${activeSessionId?.slice(0, 8)}`);
    // Get initial settings from store
    const initialOptions = $xtermOptions;

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

    term.open(terminalContainer);

    // Setup auto-scroll tracking (needs viewport DOM element from term.open)
    initAutoScroll();

    // Load WebGL addon for GPU-accelerated rendering
    // This dramatically improves performance for wide terminals
    if (!disableWebGL) {
      try {
        webglAddon = new WebglAddon();

        // Handle WebGL context loss - browser may drop it for various reasons
        webglAddon.onContextLoss(() => {
          console.warn('[Terminal] WebGL context lost, disposing addon');
          webglAddon?.dispose();
          webglAddon = null;
          // Terminal will fall back to DOM renderer automatically
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
          // Still no dimensions — will be corrected by ResizeObserver
        }
        lastCols = term.cols;
        lastRows = term.rows;
        initialSizingComplete = true;
        console.log(`[Terminal:${terminalInstanceId}] Initial sizing complete (deferred): ${lastCols}x${lastRows}`);
      });
    }

    term.onData((data) => {
        // Only send input if this terminal is in the active pane
        // This prevents duplicate input when session is mirrored to multiple panes
        // Note: We read isActive directly to get the current prop value
        console.log(`[Terminal:${terminalInstanceId}] onData: isActive=${isActive}, data="${data.replace(/[\x00-\x1f]/g, c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))}"`);
        if (manager && activeSessionId && isActive) {
            // Filter out focus in/out sequences that can interfere with TUI apps
            // \x1b[I = focus in, \x1b[O = focus out
            if (data === '\x1b[I' || data === '\x1b[O') {
                return; // Don't send focus events to the server
            }
            console.log(`[Terminal:${terminalInstanceId}] SENDING input to session ${activeSessionId.slice(0, 8)}`);
            manager.sendInput(activeSessionId, data);
        }
    });

    // Handle container resize
    function handleResize() {
      // If actively resizing (drag), defer until resize ends
      if ($isResizing) {
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
    // Scrolling the xterm-viewport can steal focus from the terminal's textarea.
    const viewport = terminalContainer.querySelector('.xterm-viewport');
    if (viewport) {
      scrollEndHandler = () => {
        if (isActive && term && !isNonTerminalFocused()) {
          term.focus();
        }
      };
      viewport.addEventListener('scrollend', scrollEndHandler);
      // Fallback: also re-focus on mouseup after a scroll drag
      viewport.addEventListener('mouseup', scrollEndHandler);
    }

    // Handle window resize
    windowResizeHandler = handleResize;
    window.addEventListener('resize', windowResizeHandler);

    // Handle visibility changes (tab switching, etc.)
    visibilityHandler = () => {
      if (document.visibilityState === 'visible' && resizeDebouncer) {
        // Flush any pending resize and recalculate
        resizeDebouncer.flush();
        requestAnimationFrame(() => {
          triggerResize(true);
        });
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

  onDestroy(() => {
    console.log(`[Terminal:${terminalInstanceId}] Destroying terminal component. Session: ${currentAttachedSessionId?.slice(0, 8)}`);
    if (writeRafId !== null) cancelAnimationFrame(writeRafId);
    writeBuffer = '';
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (outputActivityTimeout) clearTimeout(outputActivityTimeout);
    if (resizeDebouncer) resizeDebouncer.dispose();
    if (searchAddon) searchAddon.dispose();
    if (webglAddon) webglAddon.dispose();
    if (term) term.dispose();
    if (resizeObserver) resizeObserver.disconnect();
    // Use new cleanup function to properly remove listener
    cleanupOutputListener();
    if (scrollEndHandler) {
      const viewport = terminalContainer?.querySelector('.xterm-viewport');
      if (viewport) {
        viewport.removeEventListener('scrollend', scrollEndHandler);
        viewport.removeEventListener('mouseup', scrollEndHandler);
      }
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
  <div class="terminal-container" bind:this={terminalContainer} on:mousedown={() => { if (term) term.focus(); }}></div>
  <button
    class="scroll-to-bottom-badge"
    class:visible={!$autoScroll}
    on:click={() => { autoScroll.set(true); if (term) term.scrollToBottom(); }}
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
    background: var(--ui-bg-secondary, #252526);
    color: var(--ui-text-muted, #999);
    border: 1px solid var(--ui-border, #3c3c3c);
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
    color: var(--ui-text, #ccc);
  }

  /* Ensure xterm takes full space and doesn't overflow */
  .terminal-container :global(.xterm) {
    width: 100%;
    height: 100%;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
