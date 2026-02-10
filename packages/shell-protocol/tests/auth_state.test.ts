import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { ShellClient, IShellSocket } from '../src/client.js';

class MockSocket extends EventEmitter implements IShellSocket {
  send = vi.fn();
  close = vi.fn();
}

describe('ShellClient Auth State Tracking', () => {
  it('should set authenticated after receiving AuthOk and emit authenticated event', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    const onAuth = vi.fn();
    client.on('authenticated', onAuth);

    expect(client.isAuthenticated).toBe(false);

    // Server sends AuthOk
    socket.emit('message', JSON.stringify({ type: 'AuthOk', token: 'jwt-token', expires: '2026-01-30T00:00:00Z' }));

    expect(client.isAuthenticated).toBe(true);
    expect(onAuth).toHaveBeenCalled();
  });

  it('should reset authenticated on close', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    // Authenticate
    socket.emit('message', JSON.stringify({ type: 'AuthOk', token: 'jwt-token', expires: '2026-01-30T00:00:00Z' }));
    expect(client.isAuthenticated).toBe(true);

    // Close resets
    socket.emit('close');
    expect(client.isAuthenticated).toBe(false);
  });

  it('should queue messages sent before authentication and flush after auth', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    // Send messages before auth completes - should be queued, not thrown
    client.send({ type: 'list_sessions' });
    client.send({ type: 'kill_session', session_id: '123' });

    // The auth message was sent on open, but these should be queued
    // Only the auth message should have been sent to the socket so far
    // (socket.send is called for auth on 'open', but we haven't emitted 'open' yet)
    expect(socket.send).not.toHaveBeenCalled();

    // Now emit open (sends auth)
    socket.emit('open');
    // Only auth message sent
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: 'secret', protocol_version: '0.2.0' }));

    // Server confirms auth
    socket.emit('message', JSON.stringify({ type: 'AuthOk', token: 'jwt-token', expires: '2026-01-30T00:00:00Z' }));

    // Now queued messages should have been flushed
    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'list_sessions' }));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'kill_session', session_id: '123' }));
  });

  it('should send messages immediately if already authenticated', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    // Authenticate first
    socket.emit('open');
    socket.emit('message', JSON.stringify({ type: 'AuthOk', token: 'jwt-token', expires: '2026-01-30T00:00:00Z' }));
    socket.send.mockClear();

    // Now messages should go through immediately
    client.send({ type: 'list_sessions' });
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'list_sessions' }));
  });

  it('should clear queued messages on close', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    // Queue messages before auth
    client.send({ type: 'list_sessions' });

    // Close without auth
    socket.emit('close');

    // Reconnect with new socket
    const socket2 = new MockSocket();
    client.connect(socket2);
    socket2.emit('open');
    socket2.emit('message', JSON.stringify({ type: 'AuthOk', token: 'jwt-token', expires: '2026-01-30T00:00:00Z' }));

    // Only auth should have been sent, not the old queued message
    expect(socket2.send).toHaveBeenCalledTimes(1);
    expect(socket2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: 'secret', protocol_version: '0.2.0' }));
  });
});
