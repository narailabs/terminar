import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import AppToolbar from './AppToolbar.svelte';

// Mock broadcastStore
vi.mock('../lib/broadcastStore', () => {
  const { writable } = require('svelte/store');
  return {
    broadcastEnabled: writable(false),
    clearTargets: vi.fn(),
  };
});

function defaultProps() {
  return {
    connectionState: 'connected' as const,
    reconnectAttempt: 0,
    reconnectDelay: 0,
    isLocalEchoMode: false,
    isLocal: true,
    onReconnect: vi.fn(),
    onLogout: vi.fn(),
    onSettings: vi.fn(),
    onToggleBroadcast: vi.fn(),
  };
}

describe('AppToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows local echo badge when isLocalEchoMode is true', () => {
    const { container } = render(AppToolbar, {
      props: { ...defaultProps(), isLocalEchoMode: true },
    });

    const badge = container.querySelector('.local-echo-badge');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('LOCAL PTY MODE');
  });

  it('does NOT show local echo badge when isLocalEchoMode is false', () => {
    const { container } = render(AppToolbar, {
      props: { ...defaultProps(), isLocalEchoMode: false },
    });

    const badge = container.querySelector('.local-echo-badge');
    expect(badge).toBeFalsy();
  });

  it('settings button calls onSettings callback on click', async () => {
    const props = defaultProps();
    const { container } = render(AppToolbar, { props });

    const settingsBtn = container.querySelector('.settings-btn')!;
    expect(settingsBtn).toBeTruthy();

    await fireEvent.click(settingsBtn);

    expect(props.onSettings).toHaveBeenCalledOnce();
  });

  it('broadcast button calls onToggleBroadcast on click', async () => {
    const props = defaultProps();
    const { container } = render(AppToolbar, { props });

    const broadcastBtn = container.querySelector('.broadcast-btn')!;
    expect(broadcastBtn).toBeTruthy();

    await fireEvent.click(broadcastBtn);

    expect(props.onToggleBroadcast).toHaveBeenCalledOnce();
  });

  it('shows logout button when isLocal is false', () => {
    const { container } = render(AppToolbar, {
      props: { ...defaultProps(), isLocal: false },
    });

    const logoutBtn = container.querySelector('.logout-btn');
    expect(logoutBtn).toBeTruthy();
    expect(logoutBtn!.textContent).toContain('Logout');
  });

  it('hides logout button when isLocal is true', () => {
    const { container } = render(AppToolbar, {
      props: { ...defaultProps(), isLocal: true },
    });

    const logoutBtn = container.querySelector('.logout-btn');
    expect(logoutBtn).toBeFalsy();
  });

  it('shortcuts popup shows on keyboard button click', async () => {
    const { container } = render(AppToolbar, {
      props: defaultProps(),
    });

    // Popup should not be visible initially
    expect(container.querySelector('.shortcuts-popup')).toBeFalsy();

    const shortcutsBtn = container.querySelector('.shortcuts-btn')!;
    expect(shortcutsBtn).toBeTruthy();

    await fireEvent.click(shortcutsBtn);

    const popup = container.querySelector('.shortcuts-popup');
    expect(popup).toBeTruthy();
    expect(popup!.textContent).toContain('Keyboard Shortcuts');
  });

  it('shortcuts popup auto-closes after 8 seconds', async () => {
    vi.useFakeTimers();

    try {
      const { container } = render(AppToolbar, {
        props: defaultProps(),
      });

      const shortcutsBtn = container.querySelector('.shortcuts-btn')!;
      await fireEvent.click(shortcutsBtn);

      // Popup should be visible
      expect(container.querySelector('.shortcuts-popup')).toBeTruthy();

      // Advance time by 8 seconds (async version lets microtasks/Svelte reactivity flush)
      await vi.advanceTimersByTimeAsync(8000);

      // Popup should be closed
      expect(container.querySelector('.shortcuts-popup')).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });
});
