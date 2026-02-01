import { describe, it, expect } from 'vitest';
import { ClientMessageSchema, ServerMessageSchema } from '../src/messages.js';

describe('ClientMessage Validation', () => {
  it('validates auth', () => {
    const msg = { type: 'auth', token: 'secret' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates list_sessions', () => {
    const msg = { type: 'list_sessions' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates create_session', () => {
    const msg = { 
      type: 'create_session', 
      cwd: '/tmp', 
      shell: 'bash', 
      env: { PATH: '/bin' }, 
      cols: 80, 
      rows: 24 
    };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates attach', () => {
    const msg = { type: 'attach', session_id: '123', mode: 'mirror' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates input', () => {
    const msg = { type: 'input', session_id: '123', data: 'ls\n' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates resize', () => {
    const msg = { type: 'resize', session_id: '123', cols: 100, rows: 40 };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates rename_session', () => {
    const msg = { type: 'rename_session', session_id: '123', new_name: 'prod' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates kill_session', () => {
    const msg = { type: 'kill_session', session_id: '123' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('fails on missing required fields', () => {
    const msg = { type: 'create_session', cwd: '/' }; // Missing shell, env, etc.
    expect(() => ClientMessageSchema.parse(msg)).toThrow();
  });

  it('fails on incorrect types', () => {
    const msg = { type: 'resize', session_id: '123', cols: '100', rows: 24 }; // cols is string
    expect(() => ClientMessageSchema.parse(msg)).toThrow();
  });

  it('validates auth_password', () => {
    const msg = { type: 'auth_password', username: 'narayan', password: 'secret' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates auth_pubkey_init', () => {
    const msg = { type: 'auth_pubkey_init', username: 'narayan', pubkey: 'c3NoLWVkMjU1MTk=' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates auth_pubkey_verify', () => {
    const msg = { type: 'auth_pubkey_verify', signature: 'sig-base64', algorithm: 'ssh-ed25519' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates auth_token', () => {
    const msg = { type: 'auth_token', token: 'eyJhbGciOiJIUzI1NiJ9.test.sig' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });
});

describe('ServerMessage Validation', () => {
  it('validates SessionList', () => {
    const msg = {
      type: 'SessionList',
      sessions: [
        { id: '1', name: 'test', shell: 'bash', started_at: 'now' }
      ]
    };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates Output', () => {
    const msg = { type: 'Output', session_id: '1', data: 'hello' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates SessionClosed', () => {
    const msg = { type: 'SessionClosed', session_id: '1' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates Error', () => {
    const msg = { type: 'Error', message: 'Something went wrong' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates AuthOk with JWT', () => {
    const msg = { type: 'AuthOk', token: 'eyJ.test.sig', expires: '2026-01-30T06:42:08Z' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates AuthChallenge', () => {
    const msg = { type: 'AuthChallenge', nonce: 'random-nonce-base64' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('fails on unknown message type', () => {
    const msg = { type: 'Unknown' };
    expect(() => ServerMessageSchema.parse(msg)).toThrow();
  });
});