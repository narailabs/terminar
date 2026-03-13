import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { ShellClient, IShellSocket } from '../src/client.js';

class MockSocket extends EventEmitter implements IShellSocket {
  send = vi.fn();
  close = vi.fn();
}

describe('ShellClient Connection', () => {
  it('should emit connected on socket open', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    const onConnected = vi.fn();
    client.on('connected', onConnected);

    socket.emit('open');

    expect(onConnected).toHaveBeenCalled();
  });

  it('should send messages immediately without auth handshake', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    // Send messages right away — no auth gating
    client.send({ type: 'list_sessions' });
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'list_sessions' }));

    client.send({ type: 'kill_session', session_id: '123' });
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'kill_session', session_id: '123' }));
  });

  it('should not send any auth message on open', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    socket.emit('open');

    // No auth message should be sent
    expect(socket.send).not.toHaveBeenCalled();
  });
});
