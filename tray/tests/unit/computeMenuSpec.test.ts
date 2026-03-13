import { describe, it, expect } from 'vitest';
import { computeMenuSpec } from '../../src/main/menuSpec.js';

describe('computeMenuSpec', () => {
  it('shows "Running" when server is running', () => {
    const spec = computeMenuSpec('running');

    expect(spec.status_text).toContain('Running');
    expect(spec.status_text).toContain('\u25CF'); // filled circle
    expect(spec.is_running).toBe(true);
  });

  it('shows "Stopped" when server is stopped', () => {
    const spec = computeMenuSpec('stopped');

    expect(spec.status_text).toContain('Stopped');
    expect(spec.status_text).toContain('\u25CB'); // open circle
    expect(spec.is_running).toBe(false);
  });

  it('includes "Server:" prefix in status text', () => {
    const spec = computeMenuSpec('running');
    expect(spec.status_text).toContain('Server:');
  });
});
