import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import TabBar from './TabBar.svelte';
import type { Tab } from '../lib/workspaceTypes';

describe('TabBar - Indicators', () => {
  const makeTabs = (): Tab[] => [
    { id: 'tab-1', name: 'Terminal 1', root: { type: 'pane', id: 'p1', sessionId: 's1' } },
    { id: 'tab-2', name: 'Terminal 2', root: { type: 'pane', id: 'p2', sessionId: 's2' } },
    { id: 'tab-3', name: 'Terminal 3', root: { type: 'pane', id: 'p3', sessionId: 's3' } },
  ];

  afterEach(() => {
    cleanup();
  });

  // 1. Baseline: renders tab names correctly
  it('should render tab names correctly', () => {
    const tabs = makeTabs();
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1' },
    });

    const tabNames = container.querySelectorAll('.tab-name');
    expect(tabNames).toHaveLength(3);
    expect(tabNames[0].textContent).toBe('Terminal 1');
    expect(tabNames[1].textContent).toBe('Terminal 2');
    expect(tabNames[2].textContent).toBe('Terminal 3');
  });

  // 2. Shows activity dot badge when tabActivities has entry for a non-active tab
  it('should show activity dot badge for non-active tab with activity', () => {
    const tabs = makeTabs();
    const tabActivities = new Map([['tab-2', 'output']]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabActivities },
    });

    const badges = container.querySelectorAll('[data-testid="activity-badge"]');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    // The badge should be within the tab-2 element
    const tab2 = container.querySelectorAll('.tab')[1];
    expect(tab2.querySelector('[data-testid="activity-badge"]')).toBeTruthy();
  });

  // 3. Does NOT show activity badge for the active tab
  it('should NOT show activity badge for the active tab', () => {
    const tabs = makeTabs();
    const tabActivities = new Map([['tab-1', 'output']]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabActivities },
    });

    const tab1 = container.querySelectorAll('.tab')[0];
    expect(tab1.querySelector('[data-testid="activity-badge"]')).toBeFalsy();
  });

  // 4. Shows bell icon for bell activity type
  it('should show bell icon for bell activity type', () => {
    const tabs = makeTabs();
    const tabActivities = new Map([['tab-2', 'bell']]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabActivities },
    });

    const tab2 = container.querySelectorAll('.tab')[1];
    const badge = tab2.querySelector('[data-testid="activity-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('\uD83D\uDD14'); // 🔔
  });

  // 5. Shows silence indicator for silence type
  it('should show silence indicator for silence activity type', () => {
    const tabs = makeTabs();
    const tabActivities = new Map([['tab-2', 'silence']]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabActivities },
    });

    const tab2 = container.querySelectorAll('.tab')[1];
    const badge = tab2.querySelector('[data-testid="activity-badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('\uD83D\uDCA4'); // 💤
  });

  // 6. Shows "[exited]" badge when tabExitStates has entry
  it('should show "[exited]" badge when tab has exited state', () => {
    const tabs = makeTabs();
    const tabExitStates = new Map([['tab-2', { exited: true, exitCode: null }]]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabExitStates },
    });

    const tab2 = container.querySelectorAll('.tab')[1];
    const exitBadge = tab2.querySelector('[data-testid="exit-badge"]');
    expect(exitBadge).toBeTruthy();
    expect(exitBadge!.textContent).toContain('[exited]');
  });

  // 7. Shows exit code when available: "[exited: 1]"
  it('should show exit code in badge when available', () => {
    const tabs = makeTabs();
    const tabExitStates = new Map([['tab-2', { exited: true, exitCode: 1 }]]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabExitStates },
    });

    const tab2 = container.querySelectorAll('.tab')[1];
    const exitBadge = tab2.querySelector('[data-testid="exit-badge"]');
    expect(exitBadge).toBeTruthy();
    expect(exitBadge!.textContent).toContain('[exited: 1]');
  });

  // 8. Agent icons are no longer rendered in tabs
  it('should not show agent icon even when tabAgents has entry', () => {
    const tabs = makeTabs();
    const tabAgents = new Map([['tab-1', { icon: 'C', color: '#ff6600', displayName: 'Claude' }]]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabAgents },
    });

    const tab1 = container.querySelectorAll('.tab')[0];
    const agentIcon = tab1.querySelector('[data-testid="agent-icon"]');
    expect(agentIcon).toBeNull();
  });

  // 10. Activity badge clears when tab becomes active
  it('should not show activity badge when tab becomes the activeTabId', () => {
    const tabs = makeTabs();
    // tab-2 has activity but is also active
    const tabActivities = new Map([['tab-2', 'output']]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-2', tabActivities },
    });

    const tab2 = container.querySelectorAll('.tab')[1];
    expect(tab2.querySelector('[data-testid="activity-badge"]')).toBeFalsy();
  });
});

describe('TabBar - Interactions', () => {
  const makeTabs = (): Tab[] => [
    { id: 'tab-1', name: 'Terminal 1', root: { type: 'pane', id: 'p1', sessionId: 's1' } },
    { id: 'tab-2', name: 'Terminal 2', root: { type: 'pane', id: 'p2', sessionId: 's2' } },
  ];

  afterEach(() => {
    cleanup();
  });

  it('new tab button dispatches create event', async () => {
    const handler = vi.fn();
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-1' },
      events: { create: handler },
    });
    const newTabBtn = container.querySelector('.new-tab-button')!;
    expect(newTabBtn).toBeTruthy();
    await fireEvent.click(newTabBtn);
    expect(handler).toHaveBeenCalled();
  });

  it('clicking a tab dispatches select with tabId', async () => {
    const handler = vi.fn();
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-1' },
      events: { select: handler },
    });
    const tabs = container.querySelectorAll('.tab');
    await fireEvent.click(tabs[1]);
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail).toEqual({ tabId: 'tab-2' });
  });

  it('active tab has .active class', () => {
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-2' },
    });
    const tabs = container.querySelectorAll('.tab');
    expect(tabs[0].classList.contains('active')).toBe(false);
    expect(tabs[1].classList.contains('active')).toBe(true);
  });

  it('close button dispatches close with tabId', async () => {
    const handler = vi.fn();
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-1' },
      events: { close: handler },
    });
    const closeButtons = container.querySelectorAll('.tab-close');
    expect(closeButtons.length).toBe(2);
    await fireEvent.click(closeButtons[1]);
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail).toEqual({ tabId: 'tab-2' });
  });

  it('double-click on tab enters rename mode and shows input', async () => {
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-1' },
    });
    const tabs = container.querySelectorAll('.tab');
    await fireEvent.dblClick(tabs[0]);
    const renameInput = container.querySelector('.tab-rename-input') as HTMLInputElement;
    expect(renameInput).toBeTruthy();
    expect(renameInput.value).toBe('Terminal 1');
  });

  it('submitting rename with Enter dispatches rename event', async () => {
    const handler = vi.fn();
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-1' },
      events: { rename: handler },
    });
    // Double-click to enter rename mode
    const tabs = container.querySelectorAll('.tab');
    await fireEvent.dblClick(tabs[0]);
    const renameInput = container.querySelector('.tab-rename-input') as HTMLInputElement;
    expect(renameInput).toBeTruthy();
    // Change the value and press Enter
    await fireEvent.input(renameInput, { target: { value: 'My Shell' } });
    await fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail).toEqual({ tabId: 'tab-1', name: 'My Shell' });
  });

  it('pressing Escape during rename cancels and reverts to original name', async () => {
    const handler = vi.fn();
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-1' },
      events: { rename: handler },
    });
    // Double-click to enter rename mode
    const tabs = container.querySelectorAll('.tab');
    await fireEvent.dblClick(tabs[0]);
    const renameInput = container.querySelector('.tab-rename-input') as HTMLInputElement;
    expect(renameInput).toBeTruthy();
    // Type a new name then press Escape
    await fireEvent.input(renameInput, { target: { value: 'Changed' } });
    await fireEvent.keyDown(renameInput, { key: 'Escape' });
    // Rename should NOT have been dispatched
    expect(handler).not.toHaveBeenCalled();
    // Input should be gone, tab name restored
    expect(container.querySelector('.tab-rename-input')).toBeFalsy();
    const tabNames = container.querySelectorAll('.tab-name');
    expect(tabNames[0].textContent).toBe('Terminal 1');
  });

  it('drag and drop dispatches reorder event', async () => {
    const handler = vi.fn();
    const { container } = render(TabBar, {
      props: { tabs: makeTabs(), activeTabId: 'tab-1' },
      events: { reorder: handler },
    });
    const tabs = container.querySelectorAll('.tab');

    // Simulate drag from tab-1 (index 0) to tab-2 (index 1)
    const dataTransfer = {
      effectAllowed: '',
      setData: vi.fn(),
      getData: vi.fn(() => '0'),
    };
    await fireEvent.dragStart(tabs[0], { dataTransfer });
    await fireEvent.dragOver(tabs[1]);
    await fireEvent.drop(tabs[1], { dataTransfer });

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail).toEqual({ fromIndex: 0, toIndex: 1 });
  });
});
