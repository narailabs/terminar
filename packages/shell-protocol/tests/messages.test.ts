import { describe, it, expect } from 'vitest';
import { ClientMessageSchema, ServerMessageSchema, SessionInfoSchema } from '../src/messages.js';

describe('ClientMessage Validation', () => {
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

});

describe('ServerMessage Validation', () => {
  it('validates SessionList', () => {
    const msg = {
      type: 'SessionList',
      sessions: [
        { id: '1', name: 'test', shell: 'bash', cwd: '/tmp', started_at: 'now' }
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

  it('fails on unknown message type', () => {
    const msg = { type: 'Unknown' };
    expect(() => ServerMessageSchema.parse(msg)).toThrow();
  });

  it('validates ForegroundChanged', () => {
    const msg = { type: 'ForegroundChanged', session_id: '1', process_name: 'vim' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates ForegroundChanged with null process_name', () => {
    const msg = { type: 'ForegroundChanged', session_id: '1', process_name: null };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates SessionActivity with activity type', () => {
    const msg = { type: 'SessionActivity', session_id: '1', activity_type: 'activity' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates SessionActivity with bell type', () => {
    const msg = { type: 'SessionActivity', session_id: '1', activity_type: 'bell' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates SessionActivity with silence type', () => {
    const msg = { type: 'SessionActivity', session_id: '1', activity_type: 'silence' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates SessionExited with exit_code', () => {
    const msg = { type: 'SessionExited', session_id: '1', exit_code: 0 };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates SessionExited with null exit_code', () => {
    const msg = { type: 'SessionExited', session_id: '1', exit_code: null };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates WorkspaceData with workspace object', () => {
    const msg = { type: 'WorkspaceData', workspace: { layout: 'grid', panes: [1, 2, 3] } };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates WorkspaceData with null workspace', () => {
    const msg = { type: 'WorkspaceData', workspace: null };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates Shutdown', () => {
    const msg = { type: 'Shutdown', reason: 'Server shutting down' };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });
});

describe('SessionInfo Validation', () => {
  it('validates SessionInfo with required fields only', () => {
    const session = { id: '1', name: 'test', shell: 'bash', cwd: '/tmp', started_at: '2026-02-01T00:00:00Z' };
    expect(SessionInfoSchema.parse(session)).toEqual(session);
  });

  it('accepts foreground_process as optional string', () => {
    const session = { id: '1', name: 'test', shell: 'bash', cwd: '/tmp', started_at: 'now', foreground_process: 'vim' };
    expect(SessionInfoSchema.parse(session)).toEqual(session);
  });

  it('accepts state field as optional string', () => {
    const session = { id: '1', name: 'test', shell: 'bash', cwd: '/tmp', started_at: 'now', state: 'running' };
    expect(SessionInfoSchema.parse(session)).toEqual(session);
  });

  it('accepts last_activity_at as optional string', () => {
    const session = { id: '1', name: 'test', shell: 'bash', cwd: '/tmp', started_at: 'now', last_activity_at: '2026-02-01T01:00:00Z' };
    expect(SessionInfoSchema.parse(session)).toEqual(session);
  });

  it('accepts exit_code as optional number', () => {
    const session = { id: '1', name: 'test', shell: 'bash', cwd: '/tmp', started_at: 'now', exit_code: 130 };
    expect(SessionInfoSchema.parse(session)).toEqual(session);
  });

  it('accepts all new optional fields together', () => {
    const session = {
      id: '1',
      name: 'test',
      shell: 'bash',
      cwd: '/tmp',
      started_at: 'now',
      state: 'exited',
      foreground_process: 'zsh',
      last_activity_at: '2026-02-01T01:00:00Z',
      exit_code: 0
    };
    expect(SessionInfoSchema.parse(session)).toEqual(session);
  });

  it('requires cwd field', () => {
    const session = { id: '1', name: 'test', shell: 'bash', started_at: 'now' };
    expect(() => SessionInfoSchema.parse(session)).toThrow();
  });

  it('maintains backward compatibility without optional fields', () => {
    const session = { id: '1', name: 'test', shell: 'bash', cwd: '/home/user', started_at: '2026-02-01T00:00:00Z' };
    const parsed = SessionInfoSchema.parse(session);
    expect(parsed).toEqual(session);
    expect(parsed.state).toBeUndefined();
    expect(parsed.foreground_process).toBeUndefined();
    expect(parsed.last_activity_at).toBeUndefined();
    expect(parsed.exit_code).toBeUndefined();
  });
});

describe('ClientMessage New Variants', () => {
  it('validates save_workspace', () => {
    const msg = { type: 'save_workspace', workspace: { layout: 'horizontal', panes: ['session-1', 'session-2'] } };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });

  it('validates load_workspace', () => {
    const msg = { type: 'load_workspace' };
    expect(ClientMessageSchema.parse(msg)).toEqual(msg);
  });
});