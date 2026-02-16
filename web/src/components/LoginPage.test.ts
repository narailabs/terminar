import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte';
import LoginPage from './LoginPage.svelte';

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Local connection states ──────────────────────────────────────────────

  it('shows spinner when isLocal=true and connectionState is connecting', () => {
    render(LoginPage, {
      props: { isLocal: true, connectionState: 'connecting' },
    });

    expect(document.querySelector('.spinner')).toBeTruthy();
    expect(screen.getByText('Connecting to local server...')).toBeTruthy();
  });

  it('shows retry button when isLocal=true and connectionState is disconnected', () => {
    render(LoginPage, {
      props: { isLocal: true, connectionState: 'disconnected' },
    });

    expect(screen.getByText('Failed to connect to local server.')).toBeTruthy();
    expect(screen.getByText('Retry Connection')).toBeTruthy();
  });

  it('retry button dispatches retryLocal event', async () => {
    const handler = vi.fn();
    render(LoginPage, {
      props: { isLocal: true, connectionState: 'disconnected' },
      events: { retryLocal: handler },
    });

    const retryBtn = screen.getByText('Retry Connection');
    await fireEvent.click(retryBtn);

    expect(handler).toHaveBeenCalledOnce();
  });

  // ── Auth tabs (remote mode) ──────────────────────────────────────────────

  it('shows auth tabs when isLocal is false', () => {
    render(LoginPage, {
      props: { isLocal: false },
    });

    // "Password" appears as both a tab label and a form label, so use getAllByText
    expect(screen.getAllByText('Password').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('SSH Key')).toBeTruthy();
    expect(screen.getByText('Token')).toBeTruthy();
    expect(screen.getByText('Pairing Code')).toBeTruthy();
  });

  it('switches between tabs on click', async () => {
    render(LoginPage, {
      props: { isLocal: false },
    });

    // Default tab is password - should show username/password fields
    expect(screen.getByPlaceholderText('OS username')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();

    // Switch to Token tab
    await fireEvent.click(screen.getByText('Token'));
    expect(screen.getByPlaceholderText('UUID Token or JWT')).toBeTruthy();

    // Switch to Pairing Code tab
    await fireEvent.click(screen.getByText('Pairing Code'));
    expect(screen.getByPlaceholderText('Enter 8-digit code')).toBeTruthy();

    // Switch to SSH Key tab
    await fireEvent.click(screen.getByText('SSH Key'));
    expect(screen.getByText('Private Key')).toBeTruthy();
  });

  // ── Password form ────────────────────────────────────────────────────────

  it('password form dispatches passwordAuth with username, password, and rememberMe', async () => {
    const handler = vi.fn();
    render(LoginPage, {
      props: { isLocal: false },
      events: { passwordAuth: handler },
    });

    const usernameInput = screen.getByPlaceholderText('OS username');
    await fireEvent.input(usernameInput, { target: { value: 'testuser' } });

    const passwordInput = screen.getByPlaceholderText('Password');
    await fireEvent.input(passwordInput, { target: { value: 'testpass' } });

    const signInBtn = screen.getByText('Sign In');
    await fireEvent.click(signInBtn);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail).toEqual({
      username: 'testuser',
      password: 'testpass',
      rememberMe: true,
    });
  });

  it('password form does NOT dispatch when fields are empty (button is disabled)', async () => {
    const handler = vi.fn();
    render(LoginPage, {
      props: { isLocal: false },
      events: { passwordAuth: handler },
    });

    const signInBtn = screen.getByText('Sign In');
    expect((signInBtn as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(signInBtn);
    expect(handler).not.toHaveBeenCalled();
  });

  // ── SSH Key form ─────────────────────────────────────────────────────────

  it('SSH key form dispatches sshKeyAuth with username and private key', async () => {
    const handler = vi.fn();
    render(LoginPage, {
      props: { isLocal: false },
      events: { sshKeyAuth: handler },
    });

    // Switch to SSH Key tab
    await fireEvent.click(screen.getByText('SSH Key'));

    const sshUsernameInput = screen.getByPlaceholderText('OS username');
    await fireEvent.input(sshUsernameInput, { target: { value: 'sshuser' } });

    const keyTextarea = document.querySelector('textarea')!;
    expect(keyTextarea).toBeTruthy();
    await fireEvent.input(keyTextarea, {
      target: { value: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----' },
    });

    const submitBtn = screen.getByText('Sign In with SSH Key');
    await fireEvent.click(submitBtn);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail).toEqual({
      username: 'sshuser',
      privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      rememberMe: true,
    });
  });

  // ── Token form ───────────────────────────────────────────────────────────

  it('token form dispatches tokenAuth with token value', async () => {
    const handler = vi.fn();
    render(LoginPage, {
      props: { isLocal: false },
      events: { tokenAuth: handler },
    });

    // Switch to Token tab
    await fireEvent.click(screen.getByText('Token'));

    const tokenInput = screen.getByPlaceholderText('UUID Token or JWT');
    await fireEvent.input(tokenInput, { target: { value: 'my-secret-token-123' } });

    const connectBtn = screen.getByText('Connect');
    await fireEvent.click(connectBtn);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail).toEqual({
      token: 'my-secret-token-123',
    });
  });

  // ── Pairing form ─────────────────────────────────────────────────────────

  it('pairing form dispatches pairingAuth when code is at least 6 chars', async () => {
    const handler = vi.fn();
    render(LoginPage, {
      props: { isLocal: false },
      events: { pairingAuth: handler },
    });

    // Switch to Pairing Code tab
    await fireEvent.click(screen.getByText('Pairing Code'));

    const codeInput = screen.getByPlaceholderText('Enter 8-digit code');
    await fireEvent.input(codeInput, { target: { value: '12345678' } });

    const submitBtn = screen.getByText('Submit');
    await fireEvent.click(submitBtn);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail).toEqual({
      code: '12345678',
    });
  });

  // ── Enter key submission ─────────────────────────────────────────────────

  it('Enter key submits the active password form', async () => {
    const handler = vi.fn();
    render(LoginPage, {
      props: { isLocal: false },
      events: { passwordAuth: handler },
    });

    const usernameInput = screen.getByPlaceholderText('OS username');
    await fireEvent.input(usernameInput, { target: { value: 'enteruser' } });

    const passwordInput = screen.getByPlaceholderText('Password');
    await fireEvent.input(passwordInput, { target: { value: 'enterpass' } });

    // Press Enter on the password field
    await fireEvent.keyDown(passwordInput, { key: 'Enter' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail).toEqual({
      username: 'enteruser',
      password: 'enterpass',
      rememberMe: true,
    });
  });

  // ── Auth error display ───────────────────────────────────────────────────

  it('shows authError when provided', () => {
    render(LoginPage, {
      props: { isLocal: false, authError: 'Invalid credentials' },
    });

    expect(screen.getByText('Invalid credentials')).toBeTruthy();
  });
});
