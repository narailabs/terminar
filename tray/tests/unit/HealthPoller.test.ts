import { describe, it, expect, afterEach } from 'vitest';
import { HealthPoller } from '../../src/main/HealthPoller.js';

describe('HealthPoller', () => {
  let poller: HealthPoller;

  afterEach(() => {
    poller?.stop();
  });

  it('starts with default (stopped) health', () => {
    poller = new HealthPoller();
    expect(poller.latestHealth.status).toBe('stopped');
    expect(poller.latestHealth.active_servers).toBeNull();
    expect(poller.latestHealth.version).toBeNull();
  });

  it('pollOnce returns stopped when no server is running', async () => {
    poller = new HealthPoller();
    // Use a port that is very unlikely to be in use
    const health = await poller.pollOnce(59999);
    expect(health.status).toBe('stopped');
  });

  it('emits health-update event', async () => {
    poller = new HealthPoller();

    const events: unknown[] = [];
    poller.on('health-update', (h) => events.push(h));

    await poller.pollOnce(59999);
    expect(events.length).toBe(1);
    expect((events[0] as { status: string }).status).toBe('stopped');
  });

  it('updates latestHealth after poll', async () => {
    poller = new HealthPoller();
    await poller.pollOnce(59999);
    expect(poller.latestHealth.status).toBe('stopped');
  });

  it('stop() clears the interval', () => {
    poller = new HealthPoller();
    poller.start(59999);
    poller.stop();
    // Should not throw and should be safe to call multiple times
    poller.stop();
  });
});
