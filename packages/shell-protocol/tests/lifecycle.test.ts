import { describe, it, expect, vi } from 'vitest';
import { ShellClient, IShellSocket } from '../src/client.js';
import { EventEmitter } from 'events';

class MockSocket extends EventEmitter implements IShellSocket {
  send = vi.fn();
  close = vi.fn();
}

describe('ShellClient Lifecycle', () => {
  it('should emit close event on socket close', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    const onClose = vi.fn();
    client.on('close', onClose);

    socket.emit('close');
    expect(onClose).toHaveBeenCalled();
  });

  it('should bubble socket errors', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    const onError = vi.fn();
    client.on('error', onError);

    const err = new Error('Network fail');
    socket.emit('error', err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('should close underlying socket', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    client.close();
    expect(socket.close).toHaveBeenCalled();
  });

  it('should detach old socket listeners on reconnect', () => {
    const socket1 = new MockSocket();
    const socket2 = new MockSocket();
    const client = new ShellClient();

    client.connect(socket1);
    client.connect(socket2);

    // Old socket events must NOT reach the client after reconnect
    const onMsg = vi.fn();
    client.on('message', onMsg);
    socket1.emit('message', JSON.stringify({ type: 'SessionList', sessions: [] }));
    expect(onMsg).not.toHaveBeenCalled();

    // New socket events should still work
    socket2.emit('message', JSON.stringify({ type: 'SessionList', sessions: [] }));
    expect(onMsg).toHaveBeenCalledTimes(1);
  });
});
