import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketAdapter } from './WebSocketAdapter';

describe('WebSocketAdapter', () => {
  let mockWebSocket: any;

  beforeEach(() => {
    mockWebSocket = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // WebSocket.OPEN
    };
  });

  it('should wrap a browser WebSocket and implement IShellSocket', () => {
    const adapter = new WebSocketAdapter(mockWebSocket);
    expect(adapter).toBeDefined();
    expect(typeof adapter.send).toBe('function');
    expect(typeof adapter.close).toBe('function');
    expect(typeof adapter.on).toBe('function');
  });

  it('should forward send() to the underlying WebSocket', () => {
    const adapter = new WebSocketAdapter(mockWebSocket);
    adapter.send('{"type":"list_sessions"}');
    expect(mockWebSocket.send).toHaveBeenCalledWith('{"type":"list_sessions"}');
  });

  it('should forward close() to the underlying WebSocket', () => {
    const adapter = new WebSocketAdapter(mockWebSocket);
    adapter.close();
    expect(mockWebSocket.close).toHaveBeenCalled();
  });

  it('should emit "open" when the underlying WebSocket opens', () => {
    const adapter = new WebSocketAdapter(mockWebSocket);
    const openSpy = vi.fn();
    adapter.on('open', openSpy);

    // Simulate the WebSocket 'open' event
    const openHandler = mockWebSocket.addEventListener.mock.calls.find(
      (call: any[]) => call[0] === 'open'
    )?.[1];
    expect(openHandler).toBeDefined();
    openHandler();

    expect(openSpy).toHaveBeenCalled();
  });

  it('should emit "message" with string data when the underlying WebSocket receives a message', () => {
    const adapter = new WebSocketAdapter(mockWebSocket);
    const msgSpy = vi.fn();
    adapter.on('message', msgSpy);

    // Simulate the WebSocket 'message' event
    const messageHandler = mockWebSocket.addEventListener.mock.calls.find(
      (call: any[]) => call[0] === 'message'
    )?.[1];
    expect(messageHandler).toBeDefined();
    messageHandler({ data: '{"type":"SessionList","sessions":[]}' });

    expect(msgSpy).toHaveBeenCalledWith('{"type":"SessionList","sessions":[]}');
  });

  it('should emit "close" when the underlying WebSocket closes', () => {
    const adapter = new WebSocketAdapter(mockWebSocket);
    const closeSpy = vi.fn();
    adapter.on('close', closeSpy);

    const closeHandler = mockWebSocket.addEventListener.mock.calls.find(
      (call: any[]) => call[0] === 'close'
    )?.[1];
    expect(closeHandler).toBeDefined();
    closeHandler();

    expect(closeSpy).toHaveBeenCalled();
  });

  it('should emit "error" when the underlying WebSocket errors', () => {
    const adapter = new WebSocketAdapter(mockWebSocket);
    const errorSpy = vi.fn();
    adapter.on('error', errorSpy);

    const errorHandler = mockWebSocket.addEventListener.mock.calls.find(
      (call: any[]) => call[0] === 'error'
    )?.[1];
    expect(errorHandler).toBeDefined();
    const err = new Error('connection failed');
    errorHandler(err);

    expect(errorSpy).toHaveBeenCalledWith(err);
  });
});
