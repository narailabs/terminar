import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { ShellClient, IShellSocket } from '../src/client.js';

class MockSocket extends EventEmitter implements IShellSocket {
  send = vi.fn();
  close = vi.fn();
}

describe('ShellClient', () => {
  it('should send auth on connect', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    socket.emit('open');
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: 'secret' }));
  });

  it('should emit message on valid server message', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    const onMessage = vi.fn();
    client.on('message', onMessage);

    const serverMsg = { type: 'SessionList', sessions: [] };
    socket.emit('message', JSON.stringify(serverMsg));

    expect(onMessage).toHaveBeenCalledWith(serverMsg);
  });

  it('should emit specific event type', () => {
    const socket = new MockSocket();
    const client = new ShellClient('secret');
    client.connect(socket);

    const onOutput = vi.fn();
    client.on('Output', onOutput);

    const serverMsg = { type: 'Output', session_id: '1', data: 'hello' };
    socket.emit('message', JSON.stringify(serverMsg));

    expect(onOutput).toHaveBeenCalledWith(serverMsg);
  });
});
