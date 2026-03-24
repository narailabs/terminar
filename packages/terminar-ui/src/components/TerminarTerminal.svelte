<svelte:options customElement="terminar-terminal" />

<script lang="ts">
  /**
   * <terminar-terminal> - Standalone xterm.js terminal web component.
   *
   * All dependencies are passed as props (no store/context imports).
   * Adapted from web/src/components/Terminal.svelte.
   */
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { Unicode11Addon } from '@xterm/addon-unicode11';
  import { SearchAddon } from '@xterm/addon-search';
  import '@xterm/xterm/css/xterm.css';
  import type { SessionManager } from '../lib/SessionManager';
  import type { TerminalSettings, TerminalTheme } from '../lib/types';
  import { TerminalResizeDebouncer } from '../lib/TerminalResizeDebouncer';

  let {
    sessionManager = null,
    activeSessionId = null,
    isActive = false,
    settings = undefined,
    theme = undefined,
    resizeSignal = 0,
    onready = undefined,
    ontitlechange = undefined,
    onsearchresults = undefined,
  }: {
    sessionManager?: SessionManager | null;
    activeSessionId?: string | null;
    isActive?: boolean;
    settings?: TerminalSettings;
    theme?: TerminalTheme;
    resizeSignal?: number;
    onready?: ((term: Terminal) => void);
    ontitlechange?: ((title: string) => void);
    onsearchresults?: ((resultIndex: number, resultCount: number) => void);
  } = $props();

  const disableWebGL = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nowebgl');

  let terminalContainer: HTMLDivElement;
  let term = $state<Terminal>();
  let fitAddon: FitAddon;
  let webglAddon: WebglAddon | null = null;
  let searchAddon: SearchAddon | null = null;
  let resizeObserver: ResizeObserver;
  let resizeDebouncer: TerminalResizeDebouncer | null = null;
  let previousSessionId: string | null = null;
  let lastCols: number = 0;

  // ==================== Write buffer (output coalescing) ====================
  const MAX_BUFFER_SIZE = 512 * 1024;
  const WRITE_CHUNK_SIZE = 16 * 1024;
  const MAX_WRITES_IN_FLIGHT = 2;
  const REFRESH_INTERVAL_MS = 200;

  let writeBuffer = '';
  let writesInFlight = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let isAtBottom = true;
  let scrolledByUs = false;

  function enqueueOutput(data: string) {
    if (writeBuffer.length + data.length > MAX_BUFFER_SIZE) {
      writeBuffer = writeBuffer.slice(-(MAX_BUFFER_SIZE - data.length));
    }
    writeBuffer += data;
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(flushBuffer, 4);
  }

  function flushBuffer() {
    flushTimer = null;
    if (!term || writeBuffer.length === 0) return;
    const deadline = performance.now() + 8;
    while (writeBuffer.length > 0 && writesInFlight < MAX_WRITES_IN_FLIGHT && performance.now() < deadline) {
      const chunk = writeBuffer.slice(0, WRITE_CHUNK_SIZE);
      writeBuffer = writeBuffer.slice(WRITE_CHUNK_SIZE);
      writesInFlight++;
      term.write(chunk, () => { writesInFlight--; });
    }
    if (writeBuffer.length > 0) scheduleFlush();
    if (!refreshTimer) {
      refreshTimer = setInterval(refreshScreen, REFRESH_INTERVAL_MS);
    }
  }

  function refreshScreen() {
    if (writeBuffer.length === 0 && writesInFlight === 0) {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }
    if (isAtBottom && term) {
      scrolledByUs = true;
      term.scrollToBottom();
      scrolledByUs = false;
    }
  }

  // ==================== Public methods ====================
  export function getSelection(): string {
    return term?.getSelection() ?? '';
  }

  export function pasteText(text: string) {
    if (term && sessionManager && activeSessionId && isActive) {
      sessionManager.sendInput(activeSessionId, text);
    }
  }

  export function selectAll() {
    if (term) term.selectAll();
  }

  export function refit() {
    if (fitAddon && term) {
      try { fitAddon.fit(); } catch { /* ignore */ }
    }
  }

  export function searchFindNext(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    if (!searchAddon || !query) return false;
    return searchAddon.findNext(query, { ...options, decorations: searchDecorations });
  }

  export function searchFindPrevious(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    if (!searchAddon || !query) return false;
    return searchAddon.findPrevious(query, { ...options, decorations: searchDecorations });
  }

  export function searchClearDecorations() {
    searchAddon?.clearDecorations();
  }

  const searchDecorations = {
    matchBackground: '#515C6A',
    matchBorder: '#74879F',
    matchOverviewRuler: '#515C6A',
    activeMatchBackground: '#515C6A',
    activeMatchBorder: '#FFA500',
    activeMatchColorOverviewRuler: '#FFA500',
  };

  // ==================== Session management ====================
  function attachSession(id: string) {
    if (!sessionManager) return;
    sessionManager.attach(id);
    sessionManager.on('output', handleOutput);
  }

  function detachSession() {
    if (!sessionManager) return;
    sessionManager.removeListener('output', handleOutput);
  }

  function handleOutput(data: { session_id: string; data: string }) {
    if (data.session_id === activeSessionId) {
      enqueueOutput(data.data);
    }
  }

  // ==================== Effects ====================
  $effect(() => {
    if (activeSessionId !== previousSessionId) {
      if (previousSessionId) detachSession();
      if (activeSessionId && term) {
        term.clear();
        term.reset();
        attachSession(activeSessionId);
      }
      previousSessionId = activeSessionId;
    }
  });

  $effect(() => {
    if (settings && term) {
      term.options.fontSize = settings.fontSize;
      term.options.fontFamily = settings.fontFamily;
      term.options.lineHeight = settings.lineHeight;
      term.options.cursorStyle = settings.cursorStyle as 'block' | 'underline' | 'bar';
      term.options.cursorBlink = settings.cursorBlink;
      refit();
    }
  });

  $effect(() => {
    if (theme && term) {
      term.options.theme = theme;
    }
  });

  // Respond to external resize signal
  $effect(() => {
    if (resizeSignal > 0) {
      refit();
    }
  });

  // ==================== Lifecycle ====================
  onMount(() => {
    const xtermOpts: any = {
      allowProposedApi: true,
      scrollback: 10000,
      fontSize: settings?.fontSize ?? 14,
      fontFamily: settings?.fontFamily ?? 'Menlo, Monaco, "Courier New", monospace',
      lineHeight: settings?.lineHeight ?? 1.0,
      cursorStyle: (settings?.cursorStyle as 'block' | 'underline' | 'bar') ?? 'block',
      cursorBlink: settings?.cursorBlink ?? true,
      theme: theme ?? {},
    };

    const t = new Terminal(xtermOpts);
    term = t;
    fitAddon = new FitAddon();
    t.loadAddon(fitAddon);

    const unicodeAddon = new Unicode11Addon();
    t.loadAddon(unicodeAddon);
    t.unicode.activeVersion = '11';

    searchAddon = new SearchAddon();
    t.loadAddon(searchAddon);
    if (onsearchresults) {
      searchAddon.onDidChangeResults((e) => {
        onsearchresults?.(e.resultIndex, e.resultCount);
      });
    }

    t.open(terminalContainer);

    if (!disableWebGL) {
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon?.dispose();
          webglAddon = null;
        });
        t.loadAddon(webglAddon);
      } catch { /* WebGL unavailable */ }
    }

    fitAddon.fit();
    lastCols = t.cols;

    resizeDebouncer = new TerminalResizeDebouncer(
      () => term ?? null,
      (cols, rows) => {
        if (sessionManager && activeSessionId) {
          sessionManager.resize(activeSessionId, cols, rows);
        }
      }
    );

    resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const cols = t.cols;
        const rows = t.rows;
        resizeDebouncer?.resize(cols, rows);
      } catch { /* ignore */ }
    });
    resizeObserver.observe(terminalContainer);

    t.onData((data) => {
      if (sessionManager && activeSessionId && isActive) {
        sessionManager.sendInput(activeSessionId, data);
      }
    });

    t.onTitleChange((title) => {
      ontitlechange?.(title);
    });

    t.onScroll(() => {
      if (!scrolledByUs && t) {
        const buf = t.buffer.active;
        isAtBottom = buf.viewportY >= buf.baseY;
      }
    });

    if (activeSessionId) {
      attachSession(activeSessionId);
      previousSessionId = activeSessionId;
    }

    onready?.(t);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    resizeDebouncer?.dispose();
    detachSession();
    if (flushTimer) clearTimeout(flushTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    webglAddon?.dispose();
    searchAddon?.dispose();
    term?.dispose();
  });
</script>

<div class="terminal-wrapper" bind:this={terminalContainer}></div>

<style>
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
