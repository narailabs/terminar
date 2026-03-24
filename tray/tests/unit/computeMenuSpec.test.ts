import { describe, it, expect } from 'vitest';
import { computeMenuSpec } from '../../src/main/menuSpec.js';
import { DEFAULT_HEALTH } from '../../src/main/types.js';
import type { ServerHealth } from '../../src/main/types.js';

describe('computeMenuSpec', () => {
  it('shows "Stopped" when server is stopped', () => {
    const health: ServerHealth = { ...DEFAULT_HEALTH };
    const spec = computeMenuSpec(health, 6750);

    expect(spec.status_text).toContain('Stopped');
    expect(spec.status_text).toContain('\u25CB'); // open circle
    expect(spec.is_running).toBe(false);
  });

  it('shows "Running" when server is running', () => {
    const health: ServerHealth = {
      status: 'running',
      version: '1.0.0',
    };
    const spec = computeMenuSpec(health, 6750);

    expect(spec.status_text).toContain('Running');
    expect(spec.status_text).toContain('\u25CF'); // filled circle
    expect(spec.is_running).toBe(true);
  });

  it('shows "Starting" status', () => {
    const health: ServerHealth = {
      status: 'starting',
      version: null,
    };
    const spec = computeMenuSpec(health, 6750);

    expect(spec.status_text).toContain('Starting');
    expect(spec.status_text).toContain('\u25D4'); // half circle
    expect(spec.is_running).toBe(false);
  });

  it('includes port in status text', () => {
    const health: ServerHealth = { ...DEFAULT_HEALTH };
    const spec = computeMenuSpec(health, 8080);

    expect(spec.status_text).toContain('port 8080');
  });

  it('labels as "Server" in status text', () => {
    const health: ServerHealth = { ...DEFAULT_HEALTH };
    const spec = computeMenuSpec(health, 6750);

    expect(spec.status_text).toContain('Server:');
  });
});
