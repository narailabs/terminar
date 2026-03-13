import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import {
  ShellClient,
  ShellProtocolError,
  SessionError,
  ParseError,
  ValidationError,
  ServerMessageSchema,
  ClientMessageSchema,
  SessionInfoSchema,
  VERSION,
} from '../src/index.js';

describe('Dead Code Removal', () => {
  it('should have no unused imports (tsc --noUnusedLocals passes)', () => {
    const projectRoot = path.resolve(__dirname, '..');
    // This will throw if there are unused imports/locals
    const result = execSync('npx tsc --noEmit --noUnusedLocals', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // If we get here, compilation succeeded with no unused locals
    expect(result).toBeDefined();
  });

  it('should export all public types from index.ts', () => {
    expect(ShellClient).toBeDefined();
    expect(ShellProtocolError).toBeDefined();
    expect(SessionError).toBeDefined();
    expect(ParseError).toBeDefined();
    expect(ValidationError).toBeDefined();
    expect(ServerMessageSchema).toBeDefined();
    expect(ClientMessageSchema).toBeDefined();
    expect(SessionInfoSchema).toBeDefined();
    expect(VERSION).toBeDefined();
  });
});
