import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  ShellProtocolError,
  SessionError,
  ParseError,
  ValidationError,
} from '../src/errors.js';
import { ShellClient, IShellSocket } from '../src/client.js';

class MockSocket extends EventEmitter implements IShellSocket {
  send = vi.fn();
  close = vi.fn();
}

describe('Error Classes', () => {
  it('ShellProtocolError is an Error with a code', () => {
    const err = new ShellProtocolError('something broke', 'SESSION_NOT_FOUND');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ShellProtocolError);
    expect(err.message).toBe('something broke');
    expect(err.code).toBe('SESSION_NOT_FOUND');
    expect(err.name).toBe('ShellProtocolError');
  });

  it('SessionError has SESSION_NOT_FOUND code by default', () => {
    const err = new SessionError('no such session');
    expect(err).toBeInstanceOf(ShellProtocolError);
    expect(err).toBeInstanceOf(SessionError);
    expect(err.code).toBe('SESSION_NOT_FOUND');
    expect(err.name).toBe('SessionError');
  });

  it('ParseError has PARSE_ERROR code', () => {
    const err = new ParseError('invalid json');
    expect(err).toBeInstanceOf(ShellProtocolError);
    expect(err).toBeInstanceOf(ParseError);
    expect(err.code).toBe('PARSE_ERROR');
    expect(err.name).toBe('ParseError');
  });

  it('ValidationError has VALIDATION_ERROR code', () => {
    const err = new ValidationError('schema mismatch');
    expect(err).toBeInstanceOf(ShellProtocolError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
  });
});

describe('ShellClient Error Discrimination', () => {
  it('should emit ParseError on invalid JSON', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    const onError = vi.fn();
    client.on('error', onError);

    socket.emit('message', 'not valid json{{{');

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(ParseError);
    expect(err.code).toBe('PARSE_ERROR');
  });

  it('should emit ValidationError on schema validation failure', () => {
    const socket = new MockSocket();
    const client = new ShellClient();
    client.connect(socket);

    const onError = vi.fn();
    client.on('error', onError);

    // Valid JSON but invalid schema (SessionList missing sessions field)
    socket.emit('message', JSON.stringify({ type: 'SessionList' }));

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION_ERROR');
  });
});
