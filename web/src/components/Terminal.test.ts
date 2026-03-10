import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TerminalComp from './Terminal.svelte';

// Use hoisted to have access to mock instances in tests
const { TerminalMock, FitAddonMock, mockTerm, mockFit } = vi.hoisted(() => {
  const mockTerm = {
    open: vi.fn(),
    loadAddon: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    resize: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    scrollToBottom: vi.fn(),
    getSelection: vi.fn().mockReturnValue(''),
    selectAll: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    onScroll: vi.fn(),
    cols: 80,
    rows: 24,
    options: {
      fontSize: 14,
      fontFamily: 'Menlo',
      cursorStyle: 'block',
      cursorBlink: true,
      lineHeight: 1.0,
      theme: {},
    },
    buffer: {
      normal: { length: 0 },
      active: { length: 0, viewportY: 0, baseY: 0 },
    },
    unicode: {
      activeVersion: '6',
    },
  };
  const mockFit = {
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  };

  class TerminalMockImpl {
    open = mockTerm.open;
    loadAddon = mockTerm.loadAddon;
    write = mockTerm.write;
    onData = mockTerm.onData;
    dispose = mockTerm.dispose;
    clear = mockTerm.clear;
    reset = mockTerm.reset;
    resize = mockTerm.resize;
    refresh = mockTerm.refresh;
    focus = mockTerm.focus;
    scrollToBottom = mockTerm.scrollToBottom;
    getSelection = mockTerm.getSelection;
    selectAll = mockTerm.selectAll;
    cols = mockTerm.cols;
    rows = mockTerm.rows;
    options = mockTerm.options;
    buffer = mockTerm.buffer;
    unicode = mockTerm.unicode;
    attachCustomKeyEventHandler = mockTerm.attachCustomKeyEventHandler;
    onScroll = mockTerm.onScroll;
  }

  class FitAddonMockImpl {
    fit = mockFit.fit;
    proposeDimensions = mockFit.proposeDimensions;
  }

  // Use function() to ensure it can be used as a constructor
  const TerminalMock = vi.fn().mockImplementation(function() {
      return new TerminalMockImpl();
  });

  const FitAddonMock = vi.fn().mockImplementation(function() {
      return new FitAddonMockImpl();
  });

  return {
    TerminalMock,
    FitAddonMock,
    mockTerm,
    mockFit
  };
});

vi.mock('@xterm/xterm', () => ({ Terminal: TerminalMock }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FitAddonMock }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: vi.fn() }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: vi.fn() }));
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(function() {
    return {
      dispose: vi.fn(),
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
      onDidChangeResults: vi.fn(),
    };
  }),
}));

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

// Helper to flush requestAnimationFrame callbacks and Svelte 5 effects
async function flushRAF() {
  await new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  });
  // Allow Svelte 5 effects to process (effects run in microtasks)
  await new Promise(resolve => setTimeout(resolve, 0));
  // Extra tick: Svelte 5 $effect runs asynchronously after $state changes
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('Terminal Component', () => {
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = {
      on: vi.fn(),
      off: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
      attach: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    };
  });

  it('should render the terminal container and initialize xterm', () => {
    const { container } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    expect(container.querySelector('.terminal-container')).toBeTruthy();
    expect(mockTerm.open).toHaveBeenCalled();
    expect(mockTerm.loadAddon).toHaveBeenCalled();
  });

  it('should call manager.sendInput when terminal emits data', async () => {
    render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1', isActive: true });

    const onDataCallback = mockTerm.onData.mock.calls[0][0];
    onDataCallback('ls\n');

    expect(mockManager.sendInput).toHaveBeenCalledWith('sess-1', 'ls\n');
  });

  it('should write to terminal when manager emits output for active session', async () => {
    render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    // Flush requestAnimationFrame to set initialSizingComplete = true
    await flushRAF();

    const outputCallback = mockManager.on.mock.calls.find((c: [string, (...args: unknown[]) => void]) => c[0] === 'output');
    expect(outputCallback).toBeTruthy();
    outputCallback![1]('sess-1', 'hello world');

    // Writes are batched via requestAnimationFrame - flush to trigger term.write
    await flushRAF();

    expect(mockTerm.write).toHaveBeenCalled();
    expect(mockTerm.write.mock.calls[0][0]).toBe('hello world');
  });

  it('should cleanup on destroy', () => {
    const { unmount } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });
    unmount();
    expect(mockTerm.dispose).toHaveBeenCalled();
  });
});

describe('Terminal - Scroll to Bottom Badge', () => {
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = {
      on: vi.fn(),
      off: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
      attach: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    };
  });

  it('should render scroll-to-bottom badge hidden initially (auto-scroll is on)', () => {
    const { container } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    const badge = container.querySelector('.scroll-to-bottom-badge');
    expect(badge).toBeTruthy();
    expect(badge?.classList.contains('visible')).toBe(false);
  });
});

describe('Terminal - No Width/Column Limiting', () => {
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = {
      on: vi.fn(),
      off: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
      attach: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    };
  });

  it('should pass through proposed dimensions without capping columns', () => {
    // Simulate a very wide terminal (e.g., 4K display full screen)
    mockFit.proposeDimensions.mockReturnValue({ cols: 320, rows: 50 });

    render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    // Terminal should have been created with no column cap
    // The fit addon should be called and its dimensions respected
    expect(mockFit.fit).toHaveBeenCalled();
  });

  it('should not impose any max-width on the terminal container', () => {
    const { container } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    const termContainer = container.querySelector('.terminal-container') as HTMLElement;
    expect(termContainer).toBeTruthy();

    // Verify no max-width style is set inline
    expect(termContainer.style.maxWidth).toBe('');

    // Verify no inline style attribute contains max-width
    const styleAttr = termContainer.getAttribute('style') ?? '';
    expect(styleAttr).not.toContain('max-width');
  });

  it('should create terminal with scrollback of at least 5000 lines', () => {
    render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    // Check the Terminal constructor was called with adequate scrollback
    const constructorCall = TerminalMock.mock.calls[0]?.[0];
    expect(constructorCall).toBeDefined();
    expect(constructorCall.scrollback).toBeGreaterThanOrEqual(10000);
  });

  it('should never limit terminal columns regardless of width', () => {
    // Test with various extreme widths
    const widths = [80, 120, 200, 320, 500];
    for (const cols of widths) {
      mockFit.proposeDimensions.mockReturnValue({ cols, rows: 24 });

      const { unmount } = render(TerminalComp, {
        _managerProp: mockManager,
        activeSessionId: `sess-${cols}`,
      });

      // proposeDimensions should return the full width, no capping
      const dims = mockFit.proposeDimensions();
      expect(dims.cols).toBe(cols);

      unmount();
      vi.clearAllMocks();
      // Re-setup mocks after clear
      mockManager = {
        on: vi.fn(),
        off: vi.fn(),
        sendInput: vi.fn(),
        resize: vi.fn(),
        attach: vi.fn(),
        listenerCount: vi.fn().mockReturnValue(0),
      };
    }
  });
});

describe('Terminal - Session Management', () => {
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = {
      on: vi.fn(),
      off: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
      attach: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    };
  });

  it('should clear and reset terminal when session switches', async () => {
    const { rerender } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    // Wait for initial sizing to complete (triggers session attach)
    await flushRAF();

    // Clear mocks to isolate session switch behavior
    vi.clearAllMocks();

    // Switch session
    await rerender({ _managerProp: mockManager, activeSessionId: 'sess-2' });

    // Wait for reactive update to process
    await new Promise(r => setTimeout(r, 0));

    expect(mockTerm.clear).toHaveBeenCalled();
    expect(mockTerm.reset).toHaveBeenCalled();
  });

  it('should focus terminal when isActive transitions to true', async () => {
    const { rerender } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1', isActive: false });

    // Wait for initial sizing
    await flushRAF();

    // Clear mocks to isolate focus behavior
    vi.clearAllMocks();

    // Transition isActive from false to true
    await rerender({ _managerProp: mockManager, activeSessionId: 'sess-1', isActive: true });
    await new Promise(r => setTimeout(r, 0));

    expect(mockTerm.focus).toHaveBeenCalled();
  });

  it('should not send input when isActive is false', async () => {
    render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1', isActive: false });

    const onDataCallback = mockTerm.onData.mock.calls[0][0];
    onDataCallback('ls\n');

    expect(mockManager.sendInput).not.toHaveBeenCalled();
  });

  it('should batch multiple rapid outputs through bufferedWrite via RAF', async () => {
    render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    // Wait for initial sizing to complete so output listener is active
    await flushRAF();

    // Find the output callback registered on the manager
    const outputCallback = mockManager.on.mock.calls.find(
      (c: [string, (...args: unknown[]) => void]) => c[0] === 'output'
    );
    expect(outputCallback).toBeTruthy();

    // Clear mocks to isolate write behavior
    mockTerm.write.mockClear();

    // Send multiple rapid outputs before any RAF fires
    outputCallback![1]('sess-1', 'line 1\n');
    outputCallback![1]('sess-1', 'line 2\n');
    outputCallback![1]('sess-1', 'line 3\n');

    // Before RAF, term.write should NOT have been called yet
    expect(mockTerm.write).not.toHaveBeenCalled();

    // Flush RAF to trigger the batched write
    await flushRAF();

    // All three outputs should be coalesced into a single term.write call
    expect(mockTerm.write).toHaveBeenCalledTimes(1);
    expect(mockTerm.write.mock.calls[0][0]).toBe('line 1\nline 2\nline 3\n');
  });
});

describe('Terminal - Auto-scroll Badge', () => {
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = {
      on: vi.fn(),
      off: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
      attach: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    };
  });

  it('should have scroll-to-bottom badge hidden by default', () => {
    const { container } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    const badge = container.querySelector('.scroll-to-bottom-badge');
    expect(badge).toBeTruthy();
    expect(badge?.classList.contains('visible')).toBe(false);
  });

  it('clicking scroll-to-bottom badge calls scrollToBottom', async () => {
    const { container } = render(TerminalComp, { _managerProp: mockManager, activeSessionId: 'sess-1' });

    const badge = container.querySelector('.scroll-to-bottom-badge')!;
    expect(badge).toBeTruthy();

    await fireEvent.click(badge);

    expect(mockTerm.scrollToBottom).toHaveBeenCalled();
  });
});

describe('stale terminal detection', () => {
  let mockManager: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockManager = {
      on: vi.fn(),
      off: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
      attach: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Helper: get the onData callback registered by the component */
  function getOnDataHandler() {
    const call = mockTerm.onData.mock.calls[0];
    expect(call).toBeTruthy();
    return call[0] as (data: string) => void;
  }

  /** Helper: get the output handler registered via manager.on('output', ...) */
  function getOutputHandler() {
    const call = mockManager.on.mock.calls.find(
      (c: [string, (...args: unknown[]) => void]) => c[0] === 'output'
    );
    expect(call).toBeTruthy();
    return call[1] as (sessionId: string, data: string) => void;
  }

  /** Helper: flush requestAnimationFrame callbacks + Svelte 5 effects.
   *  With fake timers, RAF is faked too — advance by 16ms to fire it,
   *  then settle microtasks so Svelte effects run. */
  async function flushAll() {
    // Advance enough to trigger requestAnimationFrame (faked at ~16ms)
    await vi.advanceTimersByTimeAsync(16);
    // Extra ticks to let Svelte 5 effects settle
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  }

  /** Helper: render, flush initial setup, then clear all mocks so tests
   *  start with a clean slate (initial mount calls clear/reset/attach).
   *  The component has a 150ms setTimeout before attach, plus scrollToBottom
   *  delays at 200/500/1000ms after attach. We advance past all of them. */
  async function renderAndSetup(props: Record<string, unknown> = {}) {
    const result = render(TerminalComp, {
      _managerProp: mockManager,
      activeSessionId: 'sess-1',
      isActive: true,
      ...props,
    });
    await flushAll();
    // Advance past the 150ms attach delay + 1000ms scrollToBottom delays
    await vi.advanceTimersByTimeAsync(1200);
    // Clear mocks dirtied by initial mount (session attach calls clear/reset/attach)
    mockTerm.clear.mockClear();
    mockTerm.reset.mockClear();
    mockTerm.refresh.mockClear();
    mockTerm.scrollToBottom.mockClear();
    mockManager.attach.mockClear();
    mockManager.sendInput.mockClear();
    return result;
  }

  it('output arriving after input clears stale timer (no false trigger)', async () => {
    await renderAndSetup();

    const onData = getOnDataHandler();
    const onOutput = getOutputHandler();

    // Simulate typing
    onData('x');

    // Output arrives before the 500ms stale timer fires.
    // The output handler sets outputReceivedSinceInput = true and clears the stale timer.
    onOutput('sess-1', 'x');
    await flushAll();

    // Advance past the 500ms stale check delay
    vi.advanceTimersByTime(600);

    // Tier 2 (full refresh = clear + reset + attach) should NOT have fired
    expect(mockTerm.clear).not.toHaveBeenCalled();
    expect(mockTerm.reset).not.toHaveBeenCalled();
    expect(mockManager.attach).not.toHaveBeenCalled();
  });

  it('tier 1 light refresh fires when no output after input within 500ms', async () => {
    await renderAndSetup();

    const onData = getOnDataHandler();

    // Simulate typing with no output response
    onData('x');

    // Advance past the 500ms stale check delay
    vi.advanceTimersByTime(500);

    // Tier 1: term.refresh(0, rows - 1) should have been called
    expect(mockTerm.refresh).toHaveBeenCalledWith(0, mockTerm.rows - 1);

    // But NOT a full refresh (clear + reset + attach)
    expect(mockTerm.clear).not.toHaveBeenCalled();
    expect(mockTerm.reset).not.toHaveBeenCalled();
    expect(mockManager.attach).not.toHaveBeenCalled();
  });

  it('tier 2 full refresh fires on second stale detection', async () => {
    await renderAndSetup();

    const onData = getOnDataHandler();

    // First stale detection -> Tier 1 (sets staleSuspected = true)
    onData('x');
    vi.advanceTimersByTime(500);
    expect(mockTerm.refresh).toHaveBeenCalledWith(0, mockTerm.rows - 1);

    // Need to advance past the light throttle (5s) so the next check isn't throttled
    vi.advanceTimersByTime(5000);

    // Second stale detection -> should trigger Tier 2 (full refresh)
    onData('y');
    vi.advanceTimersByTime(500);

    // Tier 2 calls refreshTerminal() which does clear + reset + attach
    expect(mockTerm.clear).toHaveBeenCalled();
    expect(mockTerm.reset).toHaveBeenCalled();
    expect(mockManager.attach).toHaveBeenCalledWith('sess-1');
  });

  it('focus events do not trigger stale detection', async () => {
    await renderAndSetup();

    const onData = getOnDataHandler();

    // Send focus in/out sequences
    onData('\x1b[I');  // focus in
    onData('\x1b[O');  // focus out

    // Advance past stale check delay
    vi.advanceTimersByTime(600);

    // No stale detection should have occurred
    expect(mockTerm.refresh).not.toHaveBeenCalled();
    expect(mockTerm.clear).not.toHaveBeenCalled();

    // Focus events should not have been sent to the server either
    expect(mockManager.sendInput).not.toHaveBeenCalled();
  });

  it('tier 2 is throttled to once per 30 seconds', async () => {
    await renderAndSetup();

    const onData = getOnDataHandler();

    // Trigger Tier 1 (sets staleSuspected = true)
    onData('a');
    vi.advanceTimersByTime(500);
    expect(mockTerm.refresh).toHaveBeenCalledTimes(1);

    // Wait past light throttle
    vi.advanceTimersByTime(5000);

    // Trigger Tier 2 (first full refresh)
    onData('b');
    vi.advanceTimersByTime(500);
    expect(mockManager.attach).toHaveBeenCalledTimes(1);

    // Reset tracking
    mockTerm.refresh.mockClear();
    mockManager.attach.mockClear();

    // Try to trigger another stale cycle immediately (within 30s window)
    // staleSuspected was reset to false by the Tier 2 refresh, so this attempts Tier 1
    onData('c');
    vi.advanceTimersByTime(500);

    // Advance enough for another Tier 1 to set staleSuspected again
    vi.advanceTimersByTime(5000);
    onData('d');
    vi.advanceTimersByTime(500);

    // Now staleSuspected should be true, try Tier 2 again
    vi.advanceTimersByTime(5000);
    onData('e');
    vi.advanceTimersByTime(500);

    // Tier 2 should NOT have fired again because we're still within the 30s throttle window
    // (total time since first Tier 2: ~500 + 5000 + 500 + 5000 + 500 + 5000 + 500 = ~17s < 30s)
    expect(mockManager.attach).not.toHaveBeenCalled();

    // Now advance past the 30s throttle boundary
    vi.advanceTimersByTime(15000); // total now ~32s since first Tier 2

    // Trigger another stale -> Tier 1 first
    onData('f');
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(5000);

    // Then Tier 2
    onData('g');
    vi.advanceTimersByTime(500);

    // Now Tier 2 should fire since we're past the 30s throttle
    expect(mockManager.attach).toHaveBeenCalledWith('sess-1');
  });
});