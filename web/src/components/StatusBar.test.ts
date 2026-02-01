import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { ConnectionState } from '../lib/SessionManager';

// Mock localStorage before any store imports
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import StatusBar from './StatusBar.svelte';
import { settingsStore } from '../lib/settingsStore';

describe('StatusBar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const defaultProps = {
    sessionName: 'my-session',
    shellType: 'zsh',
    connectionState: 'connected' as ConnectionState,
    sessionCount: 3,
    cwd: '/Users/narayan/src',
    startedAt: new Date(Date.now() - 23 * 60 * 1000).toISOString(), // 23 minutes ago
  };

  // Test 1: Status bar renders at the bottom of the window, full width
  it('should render with a status-bar class for bottom positioning', () => {
    render(StatusBar, { props: defaultProps });
    const bar = document.querySelector('.status-bar-bottom');
    expect(bar).toBeTruthy();
  });

  // Test 2: Status bar shows session name of the active pane
  it('should show the session name', () => {
    render(StatusBar, { props: defaultProps });
    expect(screen.getByText('my-session')).toBeTruthy();
  });

  // Test 3: Status bar shows shell type (e.g., "zsh")
  it('should show the shell type', () => {
    render(StatusBar, { props: defaultProps });
    expect(screen.getByText('zsh')).toBeTruthy();
  });

  // Test 4: Status bar shows connection status
  it('should show "Connected" when connection state is connected', () => {
    render(StatusBar, { props: defaultProps });
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('should show "Reconnecting..." when connection state is reconnecting', () => {
    render(StatusBar, { props: { ...defaultProps, connectionState: 'reconnecting' } });
    expect(screen.getByText('Reconnecting...')).toBeTruthy();
  });

  it('should show "Disconnected" when connection state is disconnected', () => {
    render(StatusBar, { props: { ...defaultProps, connectionState: 'disconnected' } });
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('should show "Connecting..." when connection state is connecting', () => {
    render(StatusBar, { props: { ...defaultProps, connectionState: 'connecting' } });
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  // Test 5: Status bar shows total active session count
  it('should show the session count', () => {
    render(StatusBar, { props: defaultProps });
    expect(screen.getByText('3 sessions')).toBeTruthy();
  });

  it('should show "1 session" (singular) for a single session', () => {
    render(StatusBar, { props: { ...defaultProps, sessionCount: 1 } });
    expect(screen.getByText('1 session')).toBeTruthy();
  });

  // Test 6: Status bar shows current working directory
  it('should show the current working directory', () => {
    render(StatusBar, { props: defaultProps });
    expect(screen.getByText('/Users/narayan/src')).toBeTruthy();
  });

  // Test 7: Status bar shows session uptime
  it('should show session uptime formatted as H:MM:SS', () => {
    const now = new Date('2026-02-01T10:23:15Z');
    vi.setSystemTime(now);
    const startedAt = new Date('2026-02-01T10:00:00Z').toISOString(); // 23m 15s ago
    render(StatusBar, { props: { ...defaultProps, startedAt } });
    expect(screen.getByText('0:23:15')).toBeTruthy();
  });

  // Test 8: Status bar updates when active pane changes (different props)
  it('should update when session name prop changes', () => {
    cleanup();
    const { rerender } = render(StatusBar, { props: defaultProps });
    expect(screen.getByText('my-session')).toBeTruthy();

    rerender({ ...defaultProps, sessionName: 'other-session' });
    expect(screen.getByText('other-session')).toBeTruthy();
  });

  // Test 9: Status bar updates in real-time as connection status changes
  it('should update when connection state prop changes', () => {
    cleanup();
    const { rerender } = render(StatusBar, { props: defaultProps });
    expect(screen.getByText('Connected')).toBeTruthy();

    rerender({ ...defaultProps, connectionState: 'disconnected' as ConnectionState });
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  // Test 10: Status bar is hidden when settings toggle showStatusBar is false
  it('should not render when showStatusBar setting is false', () => {
    settingsStore.updateSetting('showStatusBar', false);
    render(StatusBar, { props: defaultProps });
    const bar = document.querySelector('.status-bar-bottom');
    expect(bar).toBeNull();

    // Reset
    settingsStore.updateSetting('showStatusBar', true);
  });

  it('should render when showStatusBar setting is true', () => {
    settingsStore.updateSetting('showStatusBar', true);
    render(StatusBar, { props: defaultProps });
    const bar = document.querySelector('.status-bar-bottom');
    expect(bar).toBeTruthy();
  });

  // Test: Uptime timer updates every second
  it('should update uptime display every second', async () => {
    const now = new Date('2026-02-01T10:00:00Z');
    vi.setSystemTime(now);
    const startedAt = new Date('2026-02-01T10:00:00Z').toISOString();
    render(StatusBar, { props: { ...defaultProps, startedAt } });

    expect(screen.getByText('0:00:00')).toBeTruthy();

    // Advance 5 seconds
    await act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('0:00:05')).toBeTruthy();

    // Advance to 1 minute
    await act(() => { vi.advanceTimersByTime(55000); });
    expect(screen.getByText('0:01:00')).toBeTruthy();
  });

  // Test: Connection status has a colored indicator
  it('should have a status indicator with connected class when connected', () => {
    render(StatusBar, { props: defaultProps });
    const indicator = document.querySelector('.status-dot');
    expect(indicator).toBeTruthy();
    expect(indicator?.classList.contains('connected')).toBe(true);
  });

  it('should have a status indicator with disconnected class when disconnected', () => {
    render(StatusBar, { props: { ...defaultProps, connectionState: 'disconnected' } });
    const indicator = document.querySelector('.status-dot');
    expect(indicator?.classList.contains('disconnected')).toBe(true);
  });

  // Test: Shows placeholder when no session is active
  it('should show "No session" when sessionName is empty', () => {
    render(StatusBar, { props: { ...defaultProps, sessionName: '', shellType: '', cwd: '', startedAt: '' } });
    expect(screen.getByText('No session')).toBeTruthy();
  });
});
