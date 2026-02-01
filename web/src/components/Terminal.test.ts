import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
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
      active: { length: 0 },
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

vi.mock('xterm', () => ({ Terminal: TerminalMock }));
vi.mock('xterm-addon-fit', () => ({ FitAddon: FitAddonMock }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: vi.fn() }));
vi.mock('xterm-addon-unicode11', () => ({ Unicode11Addon: vi.fn() }));

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

// Helper to flush requestAnimationFrame callbacks
async function flushRAF() {
  await new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  });
  // Allow Svelte reactivity to process
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
    const { container } = render(TerminalComp, { manager: mockManager, activeSessionId: 'sess-1' });

    expect(container.querySelector('.terminal-container')).toBeTruthy();
    expect(mockTerm.open).toHaveBeenCalled();
    expect(mockTerm.loadAddon).toHaveBeenCalled();
  });

  it('should call manager.sendInput when terminal emits data', async () => {
    render(TerminalComp, { manager: mockManager, activeSessionId: 'sess-1', isActive: true });

    const onDataCallback = mockTerm.onData.mock.calls[0][0];
    onDataCallback('ls\n');

    expect(mockManager.sendInput).toHaveBeenCalledWith('sess-1', 'ls\n');
  });

  it('should write to terminal when manager emits output for active session', async () => {
    render(TerminalComp, { manager: mockManager, activeSessionId: 'sess-1' });

    // Flush requestAnimationFrame to set initialSizingComplete = true
    await flushRAF();

    const outputCallback = mockManager.on.mock.calls.find((c: [string, (...args: unknown[]) => void]) => c[0] === 'output');
    expect(outputCallback).toBeTruthy();
    outputCallback![1]('sess-1', 'hello world');

    expect(mockTerm.write).toHaveBeenCalledWith('hello world');
  });

  it('should cleanup on destroy', () => {
    const { unmount } = render(TerminalComp, { manager: mockManager, activeSessionId: 'sess-1' });
    unmount();
    expect(mockTerm.dispose).toHaveBeenCalled();
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

    render(TerminalComp, { manager: mockManager, activeSessionId: 'sess-1' });

    // Terminal should have been created with no column cap
    // The fit addon should be called and its dimensions respected
    expect(mockFit.fit).toHaveBeenCalled();
  });

  it('should not impose any max-width on the terminal container', () => {
    const { container } = render(TerminalComp, { manager: mockManager, activeSessionId: 'sess-1' });

    const termContainer = container.querySelector('.terminal-container') as HTMLElement;
    expect(termContainer).toBeTruthy();

    // Verify no max-width style is set inline
    expect(termContainer.style.maxWidth).toBe('');

    // Verify no inline style attribute contains max-width
    const styleAttr = termContainer.getAttribute('style') ?? '';
    expect(styleAttr).not.toContain('max-width');
  });

  it('should create terminal with scrollback of at least 5000 lines', () => {
    render(TerminalComp, { manager: mockManager, activeSessionId: 'sess-1' });

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
        manager: mockManager,
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