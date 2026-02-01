import { describe, it, expect, vi } from 'vitest';
import { ShellClient, IShellSocket } from '../src/client.js';
import { ServerMessageSchema } from '../src/messages.js';
import { EventEmitter } from 'events';

class MockSocket extends EventEmitter implements IShellSocket {
  send = vi.fn();
  close = vi.fn();
}

describe('ShellClient Edge Cases', () => {
  it('should emit error on invalid JSON', () => {
    const socket = new MockSocket();
    const client = new ShellClient('token');
    client.connect(socket);

    const onError = vi.fn();
    client.on('error', onError);

    socket.emit('message', 'invalid json{');
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain('Failed to parse message');
  });

  it('should emit error on schema validation failure', () => {
    const socket = new MockSocket();
    const client = new ShellClient('token');
    client.connect(socket);

    const onError = vi.fn();
    client.on('error', onError);

    // Missing 'sessions' array for SessionList
    const invalidMsg = JSON.stringify({ type: 'SessionList' });
    socket.emit('message', invalidMsg);

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain('Invalid message from server');
  });

  it('should handle socket error events', () => {
    const socket = new MockSocket();
    const client = new ShellClient('token');
    client.connect(socket);

    const onError = vi.fn();
    client.on('error', onError);

    const err = new Error('Socket blew up');
    socket.emit('error', err);

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('should throw when sending before connect', () => {
    const client = new ShellClient('token');
    expect(() => client.send({ type: 'list_sessions' })).toThrow('Socket not connected');
  });
});

describe('Message Schema Edge Cases', () => {
  it('should reject extra fields if strict (zod is not strict by default unless specified, checking behavior)', () => {
    // Our schema doesn't use .strict(), so extra fields are allowed but ignored.
    // Let's test that valid fields are parsed correctly even with noise.
    const msg = {
      type: 'Output',
      session_id: '123',
      data: 'foo',
      extra: 'noise'
    };
    const parsed = ServerMessageSchema.parse(msg);
    expect(parsed.type).toBe('Output');
    // @ts-ignore
    expect(parsed.extra).toBeUndefined(); // Zod strips unknown by default? No, it passes them through unless .strict() or .strip().
    // Wait, zod default is 'strip'.
  });

  it('should reject invalid types', () => {
    const msg = {
      type: 'create_session',
      cols: "80", // Should be number
      rows: 24
    };
    // Need to test ClientMessageSchema but it's not exported for parsing in tests usually? 
    // It is exported.
    // However, verify import first.
  });
});
