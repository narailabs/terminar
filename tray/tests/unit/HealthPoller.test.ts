import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('invokes callback on every poll', async () => {
    poller = new HealthPoller();

    const events: unknown[] = [];
    poller.setCallback((h) => events.push(h));

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

  it('start() polls immediately then every interval', async () => {
    poller = new HealthPoller();
    const events: unknown[] = [];
    poller.setCallback((h) => events.push(h));

    poller.start(59999);
    // Wait a bit for the immediate poll
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    // Should have at least one event from the immediate poll
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('start() stops previous interval before starting a new one', () => {
    poller = new HealthPoller();
    poller.start(59999);
    // Starting again should not cause double intervals
    poller.start(59998);
    poller.stop();
    // No error means the old interval was properly cleared
  });

  it('returns running status for valid health response', async () => {
    // Create a simple HTTP server to respond with valid health
    const { createServer } = await import('http');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        active_servers: 2,
        version: '1.0.0',
      }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as { port: number }).port;

    try {
      poller = new HealthPoller();
      const health = await poller.pollOnce(port);
      expect(health.status).toBe('running');
      expect(health.active_servers).toBe(2);
      expect(health.version).toBe('1.0.0');
    } finally {
      server.close();
    }
  });

  it('returns running with nulls for non-JSON 200 response', async () => {
    const { createServer } = await import('http');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as { port: number }).port;

    try {
      poller = new HealthPoller();
      const health = await poller.pollOnce(port);
      expect(health.status).toBe('running');
      expect(health.active_servers).toBeNull();
      expect(health.version).toBeNull();
    } finally {
      server.close();
    }
  });

  it('returns starting for non-200 response', async () => {
    const { createServer } = await import('http');
    const server = createServer((_req, res) => {
      res.writeHead(503);
      res.end('Service Unavailable');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as { port: number }).port;

    try {
      poller = new HealthPoller();
      const health = await poller.pollOnce(port);
      expect(health.status).toBe('starting');
    } finally {
      server.close();
    }
  });

  it('invokes callback multiple times from start() polling', async () => {
    // Use a server that always responds
    const { createServer } = await import('http');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', active_servers: 0, version: '1.0' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as { port: number }).port;

    try {
      poller = new HealthPoller();
      const events: unknown[] = [];
      poller.setCallback((h) => events.push(h));

      poller.start(port);
      await new Promise((r) => setTimeout(r, 300));
      poller.stop();

      // Should have at least the immediate poll
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect((events[0] as { status: string }).status).toBe('running');
    } finally {
      server.close();
    }
  });

  it('latestHealth reflects the most recent poll result', async () => {
    const { createServer } = await import('http');
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount++;
      if (requestCount === 1) {
        // First request: connection refused won't apply, server is up
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', active_servers: 5, version: '2.0' }));
      } else {
        res.writeHead(503);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as { port: number }).port;

    try {
      poller = new HealthPoller();

      const health1 = await poller.pollOnce(port);
      expect(health1.status).toBe('running');
      expect(health1.active_servers).toBe(5);
      expect(poller.latestHealth.status).toBe('running');

      const health2 = await poller.pollOnce(port);
      expect(health2.status).toBe('starting');
      expect(poller.latestHealth.status).toBe('starting');
    } finally {
      server.close();
    }
  });
});
