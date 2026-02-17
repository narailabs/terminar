import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte';
import WorkspaceView from './WorkspaceViewTestWrapper.svelte';
import { workspaceStore } from '../lib/workspaceStore';
import { registerPane, unregisterPane } from '../lib/paneRegistry';
import type { PaneHandle } from '../lib/paneRegistry';
import { createDefaultWorkspace } from '../lib/workspaceTypes';
import { themeState, setTerminalOverride, clearTerminalOverride } from '../lib/themeStore';
import { get } from 'svelte/store';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock xterm and addons (must use vi.hoisted for proper constructor behavior)
const { TerminalMock, FitAddonMock } = vi.hoisted(() => {
  class TerminalMockImpl {
    open = vi.fn();
    loadAddon = vi.fn();
    write = vi.fn();
    onData = vi.fn();
    dispose = vi.fn();
    clear = vi.fn();
    reset = vi.fn();
    resize = vi.fn();
    refresh = vi.fn();
    focus = vi.fn();
    scrollToBottom = vi.fn();
    getSelection = vi.fn().mockReturnValue('');
    selectAll = vi.fn();
    cols = 80;
    rows = 24;
    options = {};
    buffer = { normal: { length: 0 }, active: { length: 0 } };
    unicode = { activeVersion: '6' };
    attachCustomKeyEventHandler = vi.fn();
  }

  class FitAddonMockImpl {
    fit = vi.fn();
    proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 });
  }

  // Use function() — arrow functions cannot be used as constructors
  const TerminalMock = vi.fn().mockImplementation(function () {
    return new TerminalMockImpl();
  });
  const FitAddonMock = vi.fn().mockImplementation(function () {
    return new FitAddonMockImpl();
  });

  return { TerminalMock, FitAddonMock };
});

vi.mock('xterm', () => ({ Terminal: TerminalMock }));
vi.mock('xterm-addon-fit', () => ({ FitAddon: FitAddonMock }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: vi.fn() }));
vi.mock('xterm-addon-unicode11', () => ({ Unicode11Addon: vi.fn() }));

global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue('pasted-text'),
};
Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockManager() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    sendInput: vi.fn(),
    resize: vi.fn(),
    attach: vi.fn(),
    killSession: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
    getLastSessionList: vi.fn().mockReturnValue([
      { id: 'session-1', name: 'bash' },
    ]),
  } as any;
}

/** Reset workspace store to a fresh default state and return the root pane id. */
function resetWorkspace(): string {
  const ws = createDefaultWorkspace();
  ws.activeTabId = ws.tabs[0].id;
  workspaceStore.initialize(ws);
  return ws.tabs[0].root.id;
}

/** Open the context menu by right-clicking the pane area. */
async function openContextMenu(container: HTMLElement) {
  const pane = container.querySelector('.pane');
  if (!pane) throw new Error('No .pane element found');
  await fireEvent.contextMenu(pane);
  await waitFor(() => {
    expect(container.querySelector('.context-menu')).toBeTruthy();
  });
}

/** Click a context menu item by label text. */
async function clickMenuItem(label: string) {
  const menuItem = screen.getByText(label);
  await fireEvent.click(menuItem);
}

/** Open a submenu by hovering over the parent item wrapper. */
async function openSubmenu(label: string) {
  const menuItem = screen.getByText(label);
  const wrapper = menuItem.closest('.menu-item-wrapper');
  if (!wrapper) throw new Error(`No submenu wrapper found for "${label}"`);
  await fireEvent.mouseEnter(wrapper);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Context Menu - All Items', () => {
  let mockManager: ReturnType<typeof createMockManager>;
  let paneHandle: PaneHandle;
  let paneId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClipboard.writeText.mockResolvedValue(undefined);
    mockClipboard.readText.mockResolvedValue('pasted-text');

    mockManager = createMockManager();

    // Reset to a fresh workspace with a single pane
    paneId = resetWorkspace();
    workspaceStore.assignSession(paneId, 'session-1');

    paneHandle = {
      getSelection: vi.fn().mockReturnValue('selected-text'),
      pasteText: vi.fn(),
      selectAll: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
  });

  /** Render and then override the pane registry with our mock handle */
  function renderAndRegisterMock(props: Record<string, any>) {
    const result = render(WorkspaceView, { props });
    // Pane.svelte registers itself via reactive statement — override with our mock
    registerPane(paneId, paneHandle);
    return result;
  }

  // ── Context menu rendering ───────────────────────────────────────────────

  it('should show context menu on right-click with all expected items', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);

    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Paste')).toBeTruthy();
    expect(screen.getByText('Select All')).toBeTruthy();
    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.getByText('Split')).toBeTruthy();
    expect(screen.getByText('Clear Pane')).toBeTruthy();
    expect(screen.getByText('Close Pane')).toBeTruthy();

    // Open the Split submenu and check all four directions
    await openSubmenu('Split');
    expect(screen.getByText('Split Left')).toBeTruthy();
    expect(screen.getByText('Split Right')).toBeTruthy();
    expect(screen.getByText('Split Up')).toBeTruthy();
    expect(screen.getByText('Split Down')).toBeTruthy();
  });

  it('should show keyboard shortcuts in context menu', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);

    expect(screen.getByText('Cmd+C')).toBeTruthy();
    expect(screen.getByText('Cmd+V')).toBeTruthy();
    expect(screen.getByText('Cmd+A')).toBeTruthy();
    expect(screen.getByText('Cmd+W')).toBeTruthy();

    // Split shortcuts are inside the submenu
    await openSubmenu('Split');
    expect(screen.getByText('Cmd+Shift+E')).toBeTruthy();
    expect(screen.getByText('Cmd+Shift+O')).toBeTruthy();
  });

  it('should show assign options for available sessions', async () => {
    const { container } = render(WorkspaceView, {
      props: {
        manager: mockManager,
        availableSessions: [
          { id: 'sess-abc12345', name: 'zsh' },
          { id: 'sess-def67890', name: 'node' },
        ],
      },
    });

    await openContextMenu(container);

    await openSubmenu('Attach Session');
    expect(screen.getByText('zsh')).toBeTruthy();
    expect(screen.getByText('node')).toBeTruthy();
  });

  it('should close context menu on Escape', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    expect(container.querySelector('.context-menu')).toBeTruthy();

    await fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(container.querySelector('.context-menu')).toBeFalsy();
    });
  });

  it('should close context menu after clicking any item', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    expect(container.querySelector('.context-menu')).toBeTruthy();

    await clickMenuItem('Select All');

    await waitFor(() => {
      expect(container.querySelector('.context-menu')).toBeFalsy();
    });
  });

  // ── Copy ─────────────────────────────────────────────────────────────────

  it('Copy: should read selection from pane and write to clipboard', async () => {
    const { container } = renderAndRegisterMock({ manager: mockManager, availableSessions: [] });

    await openContextMenu(container);
    await clickMenuItem('Copy');

    expect(paneHandle.getSelection).toHaveBeenCalled();
    expect(mockClipboard.writeText).toHaveBeenCalledWith('selected-text');
  });

  it('Copy: should not write to clipboard if selection is empty', async () => {
    (paneHandle.getSelection as ReturnType<typeof vi.fn>).mockReturnValue('');

    const { container } = renderAndRegisterMock({ manager: mockManager, availableSessions: [] });

    await openContextMenu(container);
    await clickMenuItem('Copy');

    expect(paneHandle.getSelection).toHaveBeenCalled();
    expect(mockClipboard.writeText).not.toHaveBeenCalled();
  });

  // ── Paste ────────────────────────────────────────────────────────────────

  it('Paste: should read clipboard eagerly on menu open and paste into pane on click', async () => {
    const { container } = renderAndRegisterMock({ manager: mockManager, availableSessions: [] });

    await openContextMenu(container);

    // clipboard.readText is called eagerly when the context menu opens
    expect(mockClipboard.readText).toHaveBeenCalled();

    await clickMenuItem('Paste');

    expect(paneHandle.pasteText).toHaveBeenCalledWith('pasted-text');
  });

  it('Paste: should not paste if clipboard is empty', async () => {
    mockClipboard.readText.mockResolvedValue('');

    const { container } = renderAndRegisterMock({ manager: mockManager, availableSessions: [] });

    await openContextMenu(container);
    await clickMenuItem('Paste');

    expect(paneHandle.pasteText).not.toHaveBeenCalled();
  });

  // ── Select All ───────────────────────────────────────────────────────────

  it('Select All: should call selectAll on the pane', async () => {
    const { container } = renderAndRegisterMock({ manager: mockManager, availableSessions: [] });

    await openContextMenu(container);
    await clickMenuItem('Select All');

    expect(paneHandle.selectAll).toHaveBeenCalled();
  });

  // ── Split Right ──────────────────────────────────────────────────────────

  it('Split Right: should split the pane horizontally', async () => {
    const splitSpy = vi.spyOn(workspaceStore, 'splitPane');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    await openSubmenu('Split');
    await clickMenuItem('Split Right');

    expect(splitSpy).toHaveBeenCalledWith(paneId, 'horizontal');
    splitSpy.mockRestore();
  });

  // ── Split Down ───────────────────────────────────────────────────────────

  it('Split Down: should split the pane vertically', async () => {
    const splitSpy = vi.spyOn(workspaceStore, 'splitPane');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    await openSubmenu('Split');
    await clickMenuItem('Split Down');

    expect(splitSpy).toHaveBeenCalledWith(paneId, 'vertical');
    splitSpy.mockRestore();
  });

  // ── Split Left ──────────────────────────────────────────────────────────

  it('Split Left: should split the pane before horizontally', async () => {
    const splitBeforeSpy = vi.spyOn(workspaceStore, 'splitPaneBefore');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    await openSubmenu('Split');
    await clickMenuItem('Split Left');

    expect(splitBeforeSpy).toHaveBeenCalledWith(paneId, 'horizontal');
    splitBeforeSpy.mockRestore();
  });

  // ── Split Up ────────────────────────────────────────────────────────────

  it('Split Up: should split the pane before vertically', async () => {
    const splitBeforeSpy = vi.spyOn(workspaceStore, 'splitPaneBefore');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    await openSubmenu('Split');
    await clickMenuItem('Split Up');

    expect(splitBeforeSpy).toHaveBeenCalledWith(paneId, 'vertical');
    splitBeforeSpy.mockRestore();
  });

  // ── Clear Pane ───────────────────────────────────────────────────────────

  it('Clear Pane: should remove session assignment from pane', async () => {
    const assignSpy = vi.spyOn(workspaceStore, 'assignSession');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    await clickMenuItem('Clear Pane');

    expect(assignSpy).toHaveBeenCalledWith(paneId, null);
    assignSpy.mockRestore();
  });

  // ── Close Pane ───────────────────────────────────────────────────────────

  it('Close Pane: should close the pane', async () => {
    const closeSpy = vi.spyOn(workspaceStore, 'closePane');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    await clickMenuItem('Close Pane');

    expect(closeSpy).toHaveBeenCalledWith(paneId);
    closeSpy.mockRestore();
  });

  // ── Attach Session ───────────────────────────────────────────────────────

  it('Assign: should assign the selected session to the pane', async () => {
    const assignSpy = vi.spyOn(workspaceStore, 'assignSession');

    const { container } = render(WorkspaceView, {
      props: {
        manager: mockManager,
        availableSessions: [{ id: 'new-session-id', name: 'fish' }],
      },
    });

    await openContextMenu(container);
    await openSubmenu('Attach Session');
    await clickMenuItem('fish');

    expect(assignSpy).toHaveBeenCalledWith(paneId, 'new-session-id');
    assignSpy.mockRestore();
  });

  // ── Refresh Terminal ─────────────────────────────────────────────────

  it('Refresh: should call refreshTerminal on the pane', async () => {
    paneHandle.refreshTerminal = vi.fn();
    const { container } = renderAndRegisterMock({ manager: mockManager, availableSessions: [] });

    await openContextMenu(container);
    await clickMenuItem('Refresh');

    expect(paneHandle.refreshTerminal).toHaveBeenCalled();
  });
});

describe('Close Button Popup - Detach & Terminate', () => {
  let mockManager: ReturnType<typeof createMockManager>;
  let paneId: string;

  const testSessions = [
    { id: 'session-1', name: 'bash', shell: '/bin/bash', cwd: '/tmp', started_at: '2024-01-01T00:00:00Z' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = createMockManager();

    paneId = resetWorkspace();
    workspaceStore.assignSession(paneId, 'session-1');
  });

  afterEach(() => {
    cleanup();
  });

  it('should show close button (x) in the pane title bar', () => {
    render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [], initialSessions: testSessions },
    });

    const closeBtn = document.querySelector('.close-btn');
    expect(closeBtn).toBeTruthy();
    expect(closeBtn?.textContent).toContain('×');
  });

  it('should show popup with Detach and Terminate when close button is clicked', async () => {
    render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [], initialSessions: testSessions },
    });

    const closeBtn = document.querySelector('.close-btn')!;
    await fireEvent.click(closeBtn);

    expect(screen.getByText('Detach')).toBeTruthy();
    expect(screen.getByText('Remove from pane')).toBeTruthy();
    expect(screen.getByText('Terminate')).toBeTruthy();
    expect(screen.getByText('End session')).toBeTruthy();
  });

  it('should toggle popup off when close button is clicked again', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [], initialSessions: testSessions },
    });

    const closeBtn = container.querySelector('.close-btn')!;

    await fireEvent.click(closeBtn);
    expect(container.querySelector('.close-popup')).toBeTruthy();

    await fireEvent.click(closeBtn);
    expect(container.querySelector('.close-popup')).toBeFalsy();
  });

  it('Detach: should close pane without killing the session', async () => {
    const closeSpy = vi.spyOn(workspaceStore, 'closePane');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [], initialSessions: testSessions },
    });

    const closeBtn = container.querySelector('.close-btn')!;
    await fireEvent.click(closeBtn);
    await clickMenuItem('Detach');

    expect(closeSpy).toHaveBeenCalledWith(paneId);
    expect(mockManager.killSession).not.toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  it('Terminate: should kill session and close pane', async () => {
    const closeSpy = vi.spyOn(workspaceStore, 'closePane');

    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [], initialSessions: testSessions },
    });

    const closeBtn = container.querySelector('.close-btn')!;
    await fireEvent.click(closeBtn);
    await clickMenuItem('Terminate');

    expect(mockManager.killSession).toHaveBeenCalledWith('session-1');
    expect(closeSpy).toHaveBeenCalledWith(paneId);
    closeSpy.mockRestore();
  });

  it('should close popup when Escape is pressed', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [], initialSessions: testSessions },
    });

    const closeBtn = container.querySelector('.close-btn')!;
    await fireEvent.click(closeBtn);
    expect(container.querySelector('.close-popup')).toBeTruthy();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(container.querySelector('.close-popup')).toBeFalsy();
    });
  });

  it('should close popup when clicking outside', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [], initialSessions: testSessions },
    });

    const closeBtn = container.querySelector('.close-btn')!;
    await fireEvent.click(closeBtn);
    expect(container.querySelector('.close-popup')).toBeTruthy();

    // Click on the workspace content area (outside the popup)
    await fireEvent.click(container.querySelector('.workspace-content')!);

    await waitFor(() => {
      expect(container.querySelector('.close-popup')).toBeFalsy();
    });
  });

});

describe('Context Menu - Terminal Theme Override', () => {
  let mockManager: ReturnType<typeof createMockManager>;
  let paneId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = createMockManager();

    paneId = resetWorkspace();
    workspaceStore.assignSession(paneId, 'session-1');
  });

  afterEach(() => {
    cleanup();
  });

  it('should show terminal theme options in context menu', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);

    // Should show built-in terminal themes inside Theme submenu
    await openSubmenu('Theme');
    expect(screen.getByText('Dark')).toBeTruthy();
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.getByText('Dark Green')).toBeTruthy();
  });

  it('should set terminal override when theme is selected', async () => {
    const { container } = render(WorkspaceView, {
      props: { manager: mockManager, availableSessions: [] },
    });

    await openContextMenu(container);
    await openSubmenu('Theme');
    await clickMenuItem('Light');

    const state = get(themeState);
    expect(state.terminalOverrides[paneId]).toBe('light');
  });
});
