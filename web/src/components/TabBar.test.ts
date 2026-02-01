import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
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

  // 8. Shows agent icon when tabAgents has entry for a tab
  it('should show agent icon when tabAgents has entry', () => {
    const tabs = makeTabs();
    const tabAgents = new Map([['tab-1', { icon: 'C', color: '#ff6600', displayName: 'Claude' }]]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabAgents },
    });

    const tab1 = container.querySelectorAll('.tab')[0];
    const agentIcon = tab1.querySelector('[data-testid="agent-icon"]');
    expect(agentIcon).toBeTruthy();
    expect(agentIcon!.textContent).toContain('C');
  });

  // 9. Agent icon shows correct color
  it('should apply correct color to agent icon', () => {
    const tabs = makeTabs();
    const tabAgents = new Map([['tab-1', { icon: 'C', color: '#ff6600', displayName: 'Claude' }]]);
    const { container } = render(TabBar, {
      props: { tabs, activeTabId: 'tab-1', tabAgents },
    });

    const tab1 = container.querySelectorAll('.tab')[0];
    const agentIcon = tab1.querySelector('[data-testid="agent-icon"]') as HTMLElement;
    expect(agentIcon).toBeTruthy();
    expect(agentIcon.style.color).toBe('rgb(255, 102, 0)');
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
