import { describe, it, expect, vi, beforeEach } from 'vitest';

// Electron Tray/Menu/nativeImage/app must be mocked — they pull in native
// bindings that aren't available in Node test environments.
const { trayMock, menuMock, nativeImageMock, appMock, MenuClassMock } = vi.hoisted(() => {
  const trayMock = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    destroy: vi.fn(),
  };
  const menuMock = {
    buildFromTemplate: vi.fn((tpl: unknown) => ({ __tpl: tpl })),
  };
  const nativeImageMock = {
    createFromPath: vi.fn(() => ({ isEmpty: () => false, setTemplateImage: vi.fn() })),
    createFromBuffer: vi.fn(() => ({ isEmpty: () => false })),
  };
  const appMock = {
    quit: vi.fn(),
    // getAppRoot() (src/main/paths.ts) memoizes app.getAppPath() on first call.
    getAppPath: vi.fn(() => '/tmp/terminar-test-app'),
  };
  const MenuClassMock = menuMock;
  return { trayMock, menuMock, nativeImageMock, appMock, MenuClassMock };
});

vi.mock('electron', () => ({
  // `new Tray(icon)` — must be constructable.
  Tray: function Tray() { return trayMock; },
  Menu: MenuClassMock,
  nativeImage: nativeImageMock,
  app: appMock,
}));

import { TrayManager } from '../../src/main/TrayManager.js';
import type { ServerHealth } from '../../src/main/types.js';

function makeHealthPoller(health: ServerHealth) {
  return {
    latestHealth: health,
    setCallback: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

describe('TrayManager.updateMenu idempotency', () => {
  beforeEach(() => {
    trayMock.setContextMenu.mockClear();
    menuMock.buildFromTemplate.mockClear();
  });

  it('skips rebuild when health is unchanged across consecutive ticks', () => {
    const health: ServerHealth = { status: 'running', version: '1.0.0' };
    const healthPoller = makeHealthPoller(health);
    const configStore = { load: () => ({ server_port: 6750 }) };
    const windowManager = { openTerminal: vi.fn(), openSettings: vi.fn() };

    const mgr = new TrayManager(
      configStore as never,
      healthPoller as never,
      windowManager as never,
      { serverPort: 6750 },
    );

    // Constructor already triggered one updateMenu() via createTray().
    const initialCalls = trayMock.setContextMenu.mock.calls.length;

    // Simulate 10 health-poll ticks with unchanged health.
    for (let i = 0; i < 10; i++) {
      mgr.updateMenu();
    }

    // No additional setContextMenu calls — the guard worked.
    expect(trayMock.setContextMenu.mock.calls.length).toBe(initialCalls);
  });

  it('rebuilds when status transitions (running -> stopped)', () => {
    const healthPoller = makeHealthPoller({ status: 'running', version: '1.0.0' });
    const configStore = { load: () => ({ server_port: 6750 }) };
    const windowManager = { openTerminal: vi.fn(), openSettings: vi.fn() };

    const mgr = new TrayManager(
      configStore as never,
      healthPoller as never,
      windowManager as never,
      { serverPort: 6750 },
    );

    const initialCalls = trayMock.setContextMenu.mock.calls.length;

    // No-op rebuild (same spec)
    mgr.updateMenu();
    expect(trayMock.setContextMenu.mock.calls.length).toBe(initialCalls);

    // Flip health — must trigger exactly one more rebuild
    healthPoller.latestHealth = { status: 'stopped', version: null };
    mgr.updateMenu();
    expect(trayMock.setContextMenu.mock.calls.length).toBe(initialCalls + 1);

    // Another tick with the new (stopped) state — no additional rebuild
    mgr.updateMenu();
    expect(trayMock.setContextMenu.mock.calls.length).toBe(initialCalls + 1);
  });
});
