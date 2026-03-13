import { describe, it, expect, afterEach } from 'vitest';
import { HealthPoller } from '../../src/main/HealthPoller.js';

// Minimal mock for ServerManager to avoid importing Electron
class MockServerManager {
  private _running = false;

  setRunning(running: boolean): void {
    this._running = running;
  }

  isRunning(): boolean {
    return this._running;
  }
}

describe('HealthPoller', () => {
  let poller: HealthPoller;

  afterEach(() => {
    poller?.stop();
  });

  it('starts with stopped status', () => {
    poller = new HealthPoller();
    expect(poller.latestStatus).toBe('stopped');
  });

  it('pollOnce returns stopped when no server manager is set', () => {
    poller = new HealthPoller();
    const status = poller.pollOnce();
    expect(status).toBe('stopped');
  });

  it('pollOnce returns stopped when server is not running', () => {
    poller = new HealthPoller();
    const mock = new MockServerManager();
    mock.setRunning(false);
    // Use type assertion since we don't want to import the real ServerManager
    poller.setServerManager(mock as unknown as Parameters<typeof poller.setServerManager>[0]);

    const status = poller.pollOnce();
    expect(status).toBe('stopped');
  });

  it('pollOnce returns running when server is running', () => {
    poller = new HealthPoller();
    const mock = new MockServerManager();
    mock.setRunning(true);
    poller.setServerManager(mock as unknown as Parameters<typeof poller.setServerManager>[0]);

    const status = poller.pollOnce();
    expect(status).toBe('running');
  });

  it('invokes callback on every poll', () => {
    poller = new HealthPoller();

    const events: string[] = [];
    poller.setCallback((s) => events.push(s));

    poller.pollOnce();
    expect(events.length).toBe(1);
    expect(events[0]).toBe('stopped');
  });

  it('updates latestStatus after poll', () => {
    poller = new HealthPoller();
    const mock = new MockServerManager();
    mock.setRunning(true);
    poller.setServerManager(mock as unknown as Parameters<typeof poller.setServerManager>[0]);

    poller.pollOnce();
    expect(poller.latestStatus).toBe('running');

    mock.setRunning(false);
    poller.pollOnce();
    expect(poller.latestStatus).toBe('stopped');
  });

  it('stop() clears the interval', () => {
    poller = new HealthPoller();
    poller.start();
    poller.stop();
    // Should not throw and should be safe to call multiple times
    poller.stop();
  });

  it('start() polls immediately then every interval', async () => {
    poller = new HealthPoller();
    const events: string[] = [];
    poller.setCallback((s) => events.push(s));

    poller.start();
    // Wait a bit for the immediate poll
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();

    // Should have at least one event from the immediate poll
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toBe('stopped');
  });

  it('start() stops previous interval before starting a new one', async () => {
    poller = new HealthPoller();
    const events: string[] = [];
    poller.setCallback((s) => events.push(s));

    poller.start();
    // Starting again should not cause double intervals
    poller.start();
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
