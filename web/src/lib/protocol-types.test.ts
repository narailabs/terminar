import { describe, it, expect } from 'vitest';
import type { ClientMessage, ServerMessage } from './protocol-types';
import { parseServerMessage } from './protocol-types';

describe('protocol-types', () => {
  describe('ClientMessage type', () => {
    it('should support auth message type', () => {
      const msg: ClientMessage = { type: 'auth', token: 'my-token' };
      expect(msg.type).toBe('auth');
    });

    it('should support list_sessions message type', () => {
      const msg: ClientMessage = { type: 'list_sessions' };
      expect(msg.type).toBe('list_sessions');
    });

    it('should support create_session message type', () => {
      const msg: ClientMessage = {
        type: 'create_session',
        cwd: '/tmp',
        shell: 'bash',
        env: { HOME: '/root' },
        cols: 80,
        rows: 24,
      };
      expect(msg.type).toBe('create_session');
    });

    it('should support attach message type', () => {
      const msg: ClientMessage = { type: 'attach', session_id: 's1', mode: 'mirror' };
      expect(msg.type).toBe('attach');
    });

    it('should support input message type', () => {
      const msg: ClientMessage = { type: 'input', session_id: 's1', data: 'ls\n' };
      expect(msg.type).toBe('input');
    });

    it('should support resize message type', () => {
      const msg: ClientMessage = { type: 'resize', session_id: 's1', cols: 120, rows: 40 };
      expect(msg.type).toBe('resize');
    });

    it('should support rename_session message type', () => {
      const msg: ClientMessage = { type: 'rename_session', session_id: 's1', new_name: 'dev' };
      expect(msg.type).toBe('rename_session');
    });

    it('should support kill_session message type', () => {
      const msg: ClientMessage = { type: 'kill_session', session_id: 's1' };
      expect(msg.type).toBe('kill_session');
    });

    it('should support auth_password message type', () => {
      const msg: ClientMessage = { type: 'auth_password', username: 'user', password: 'pass' };
      expect(msg.type).toBe('auth_password');
    });

    it('should support auth_token message type', () => {
      const msg: ClientMessage = { type: 'auth_token', token: 'jwt-token' };
      expect(msg.type).toBe('auth_token');
    });

    it('should support auth_pubkey_init message type', () => {
      const msg: ClientMessage = { type: 'auth_pubkey_init', username: 'user', pubkey: 'ssh-ed25519 AAAA...' };
      expect(msg.type).toBe('auth_pubkey_init');
    });

    it('should support auth_pubkey_verify message type', () => {
      const msg: ClientMessage = { type: 'auth_pubkey_verify', signature: 'base64sig', algorithm: 'ssh-ed25519' };
      expect(msg.type).toBe('auth_pubkey_verify');
    });
  });

  describe('ServerMessage type', () => {
    it('should support SessionList message type', () => {
      const msg: ServerMessage = {
        type: 'SessionList',
        sessions: [{ id: '1', name: 'test', shell: 'bash', started_at: '2025-01-01' }],
      };
      expect(msg.type).toBe('SessionList');
    });

    it('should support Output message type', () => {
      const msg: ServerMessage = { type: 'Output', session_id: '1', data: 'hello' };
      expect(msg.type).toBe('Output');
    });

    it('should support SessionClosed message type', () => {
      const msg: ServerMessage = { type: 'SessionClosed', session_id: '1' };
      expect(msg.type).toBe('SessionClosed');
    });

    it('should support Error message type', () => {
      const msg: ServerMessage = { type: 'Error', message: 'not found' };
      expect(msg.type).toBe('Error');
    });

    it('should support Shutdown message type', () => {
      const msg: ServerMessage = { type: 'Shutdown', reason: 'maintenance' };
      expect(msg.type).toBe('Shutdown');
    });

    it('should support AuthOk message type', () => {
      const msg: ServerMessage = { type: 'AuthOk', token: 'jwt-token', expires: '2026-01-30T00:00:00Z' };
      expect(msg.type).toBe('AuthOk');
    });

    it('should support AuthChallenge message type', () => {
      const msg: ServerMessage = { type: 'AuthChallenge', nonce: 'base64nonce' };
      expect(msg.type).toBe('AuthChallenge');
    });
  });

  describe('parseServerMessage', () => {
    it('should parse a valid SessionList message', () => {
      const raw = { type: 'SessionList', sessions: [{ id: '1', name: 'test', shell: 'bash', started_at: '2025-01-01' }] };
      const result = parseServerMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('SessionList');
    });

    it('should parse a valid Output message', () => {
      const raw = { type: 'Output', session_id: '1', data: 'hello' };
      const result = parseServerMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('Output');
    });

    it('should parse a valid Error message', () => {
      const raw = { type: 'Error', message: 'fail' };
      const result = parseServerMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('Error');
    });

    it('should parse a valid Shutdown message', () => {
      const raw = { type: 'Shutdown', reason: 'bye' };
      const result = parseServerMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('Shutdown');
    });

    it('should parse a valid SessionClosed message', () => {
      const raw = { type: 'SessionClosed', session_id: '1' };
      const result = parseServerMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('SessionClosed');
    });

    it('should return null for unknown message types', () => {
      const raw = { type: 'UnknownType', data: 123 };
      const result = parseServerMessage(raw);
      expect(result).toBeNull();
    });

    it('should return null for malformed messages', () => {
      const raw = { type: 'SessionList' }; // missing sessions field
      const result = parseServerMessage(raw);
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = parseServerMessage(null);
      expect(result).toBeNull();
    });

    it('should parse a valid AuthOk message', () => {
      const raw = { type: 'AuthOk', token: 'jwt-token', expires: '2026-01-30T00:00:00Z' };
      const result = parseServerMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('AuthOk');
    });

    it('should parse a valid AuthChallenge message', () => {
      const raw = { type: 'AuthChallenge', nonce: 'base64nonce' };
      const result = parseServerMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('AuthChallenge');
    });

    it('should return null for AuthOk missing token', () => {
      const raw = { type: 'AuthOk', expires: '2026-01-30T00:00:00Z' };
      const result = parseServerMessage(raw);
      expect(result).toBeNull();
    });

    it('should return null for AuthChallenge missing nonce', () => {
      const raw = { type: 'AuthChallenge' };
      const result = parseServerMessage(raw);
      expect(result).toBeNull();
    });
  });
});
