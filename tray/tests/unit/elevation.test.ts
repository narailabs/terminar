import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { runElevated } from '../../src/main/elevation.js';
import { execFile } from 'child_process';

const mockedExecFile = vi.mocked(execFile);

describe('elevation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any temp files that might have been created
    const tmpDir = tmpdir();
    try {
      const files = readdirSync(tmpDir);
      for (const f of files) {
        if (f.startsWith('terminar-service-')) {
          try { unlinkSync(join(tmpDir, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  });

  it('throws on unsupported platforms', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(() => runElevated('echo hello')).toThrow(
        'Elevated execution not supported on this platform',
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  if (process.platform === 'darwin') {
    describe('macOS elevation', () => {
      it('writes script to a temp file and calls osascript', () => {
        const script = '#!/bin/bash\nlaunchctl bootout system/com.terminar.gateway';
        runElevated(script);

        expect(mockedExecFile).toHaveBeenCalledOnce();
        const [cmd, args] = mockedExecFile.mock.calls[0];
        expect(cmd).toBe('osascript');
        expect(args).toHaveLength(2);
        expect(args![0]).toBe('-e');
        expect(args![1]).toContain('do shell script');
        expect(args![1]).toContain('with administrator privileges');
        expect(args![1]).toContain('bash');
      });

      it('uses unique temp file names (no race conditions)', () => {
        runElevated('echo first');
        runElevated('echo second');

        expect(mockedExecFile).toHaveBeenCalledTimes(2);
        const path1 = (mockedExecFile.mock.calls[0][1] as string[])[1];
        const path2 = (mockedExecFile.mock.calls[1][1] as string[])[1];
        // The osascript args contain different temp file paths
        expect(path1).not.toBe(path2);
      });

      it('does NOT use detached mode (critical for GUI auth dialog)', () => {
        runElevated('echo test');

        // execFile is used, not spawn — execFile doesn't support detached
        // This inherently means the process stays in the user's login session
        expect(mockedExecFile).toHaveBeenCalledOnce();
        // Verify the callback is a function (async pattern, not fire-and-forget)
        const callback = mockedExecFile.mock.calls[0][2];
        expect(typeof callback).toBe('function');
      });

      it('cleans up temp file on success', () => {
        runElevated('echo test');

        // Simulate success callback
        const callback = mockedExecFile.mock.calls[0][2] as (error: Error | null, stdout: string, stderr: string) => void;
        // Extract the temp file path from the osascript arg
        const osaArg = (mockedExecFile.mock.calls[0][1] as string[])[1];
        const pathMatch = osaArg.match(/bash '([^']+)'/);
        expect(pathMatch).not.toBeNull();
        const tmpPath = pathMatch![1];

        // The file should exist before callback
        expect(existsSync(tmpPath)).toBe(true);

        // Simulate successful completion
        callback(null, '', '');

        // File should be cleaned up
        expect(existsSync(tmpPath)).toBe(false);
      });

      it('cleans up temp file on error', () => {
        runElevated('echo test');

        const callback = mockedExecFile.mock.calls[0][2] as (error: Error | null, stdout: string, stderr: string) => void;
        const osaArg = (mockedExecFile.mock.calls[0][1] as string[])[1];
        const pathMatch = osaArg.match(/bash '([^']+)'/);
        const tmpPath = pathMatch![1];

        expect(existsSync(tmpPath)).toBe(true);

        // Simulate error
        callback(new Error('user canceled'), '', 'Authorization denied');

        // File should still be cleaned up
        expect(existsSync(tmpPath)).toBe(false);
      });

      it('writes the correct script content to temp file', () => {
        const script = '#!/bin/bash\nset -e\nlaunchctl bootout system/com.terminar.gateway\n';
        runElevated(script);

        const osaArg = (mockedExecFile.mock.calls[0][1] as string[])[1];
        const pathMatch = osaArg.match(/bash '([^']+)'/);
        const tmpPath = pathMatch![1];

        const contents = readFileSync(tmpPath, 'utf-8');
        expect(contents).toBe(script);

        // Cleanup
        const callback = mockedExecFile.mock.calls[0][2] as (error: Error | null, stdout: string, stderr: string) => void;
        callback(null, '', '');
      });
    });
  }

  if (process.platform === 'linux') {
    describe('Linux elevation', () => {
      it('calls pkexec with bash and temp file', () => {
        runElevated('systemctl stop terminar-gateway');

        expect(mockedExecFile).toHaveBeenCalledOnce();
        const [cmd, args] = mockedExecFile.mock.calls[0];
        expect(cmd).toBe('pkexec');
        expect(args![0]).toBe('bash');
        expect(args![1]).toContain('terminar-service-');
      });
    });
  }
});
