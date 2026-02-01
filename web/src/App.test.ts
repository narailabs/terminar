import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import App from './App.svelte';
import { WebSocketSessionManager } from './lib/WebSocketSessionManager';

// Mock settingsApi to avoid actual HTTP calls
vi.mock('./lib/settingsApi', () => ({
  initializeSettings: vi.fn().mockResolvedValue(undefined),
  fetchSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  setSettingsApiBaseUrl: vi.fn(),
}));

// Mock tokenStore to avoid localStorage calls in test environment
vi.mock('./lib/tokenStore', () => ({
  saveToken: vi.fn(),
  loadToken: vi.fn().mockReturnValue(null),
  clearToken: vi.fn(),
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

vi.mock('./lib/WebSocketSessionManager', () => {
  return {
    WebSocketSessionManager: vi.fn().mockImplementation(function() {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        listSessions: vi.fn(),
        createSession: vi.fn(),
        attach: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        authenticateWithPassword: vi.fn(),
        authenticateWithToken: vi.fn(),
        authenticateWithPubkey: vi.fn(),
        getJwtToken: vi.fn(),
        disconnect: vi.fn(),
      };
    })
  };
});

// Use remote URLs to test auth UI behavior (local URLs would auto-connect)
const remoteServerProps = {
  serverHttpUrl: 'http://remote.server.com:3000',
  serverWsUrl: 'ws://remote.server.com:3000/ws',
};

describe('App Component - Remote Server (Auth Required)', () => {
  beforeEach(() => {
    vi.mocked(WebSocketSessionManager).mockClear();
  });

  it('should show login screen initially for remote server', () => {
    render(App, { props: remoteServerProps });
    expect(screen.getByText(/termiNar/)).toBeTruthy();
    // Should show tab-based login with auth tabs
    expect(screen.getByText('SSH Key')).toBeTruthy();
    expect(screen.getByText('Token')).toBeTruthy();
    expect(screen.getByText('Pairing Code')).toBeTruthy();
  });

  it('should show password form by default', () => {
    render(App, { props: remoteServerProps });
    expect(screen.getByPlaceholderText('OS username')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    expect(screen.getByText('Sign In')).toBeTruthy();
  });

  it('should show token form when Token tab is clicked', async () => {
    render(App, { props: remoteServerProps });
    const tokenTab = screen.getByText('Token');
    await fireEvent.click(tokenTab);
    expect(screen.getByPlaceholderText('UUID Token or JWT')).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
  });

  it('should show pairing form when Pairing Code tab is clicked', async () => {
    render(App, { props: remoteServerProps });
    const pairingTab = screen.getByText('Pairing Code');
    await fireEvent.click(pairingTab);
    expect(screen.getByPlaceholderText('Enter 8-digit code')).toBeTruthy();
    expect(screen.getByText('Submit')).toBeTruthy();
  });

  it('should show remember me checkbox on password tab', () => {
    render(App, { props: remoteServerProps });
    expect(screen.getByText('Remember me')).toBeTruthy();
  });
});

describe('App Component - Local Server (Auto-connect)', () => {
  beforeEach(() => {
    vi.mocked(WebSocketSessionManager).mockClear();
  });

  it('should auto-connect when server is localhost', async () => {
    render(App, { props: { serverWsUrl: 'ws://localhost:3000/ws' } });

    // Wait for async initialization (settings loading) to complete
    await waitFor(() => {
      // WebSocketSessionManager should be created without token
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });
  });

  it('should auto-connect when server is 127.0.0.1', async () => {
    render(App, { props: { serverWsUrl: 'ws://127.0.0.1:3000/ws' } });

    // Wait for async initialization (settings loading) to complete
    await waitFor(() => {
      // WebSocketSessionManager should be created
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });
  });

  it('should not show token input for local server', async () => {
    render(App, { props: { serverWsUrl: 'ws://localhost:3000/ws' } });

    // Wait for async initialization then check UI
    await waitFor(() => {
      // Password/token tabs should not be present for local connections
      expect(screen.queryByPlaceholderText('UUID Token or JWT')).toBeNull();
    });
  });
});

describe('Auth Tab Navigation', () => {
  beforeEach(() => {
    vi.mocked(WebSocketSessionManager).mockClear();
  });

  it('should switch between Password and SSH Key tabs', async () => {
    render(App, { props: remoteServerProps });

    // Default: Password tab
    expect(screen.getByPlaceholderText('OS username')).toBeTruthy();

    // Switch to SSH Key
    await fireEvent.click(screen.getByText('SSH Key'));
    expect(screen.getByText('Private Key')).toBeTruthy();
    expect(screen.getByText('Sign In with SSH Key')).toBeTruthy();

    // Switch back to Password
    await fireEvent.click(screen.getByText('Password'));
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  it('should show all four auth tabs for remote server', () => {
    render(App, { props: remoteServerProps });
    // Use getAllByText for 'Password' since it appears as both tab and form label
    const passwordElements = screen.getAllByText('Password');
    expect(passwordElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('SSH Key')).toBeTruthy();
    expect(screen.getByText('Token')).toBeTruthy();
    expect(screen.getByText('Pairing Code')).toBeTruthy();
  });
});
