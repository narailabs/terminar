import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock Tray instance
const createMockTrayInstance = () => ({
  setContextMenu: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
});

// Mock Menu.buildFromTemplate
const mockBuildFromTemplate = vi.fn();

// Mock electron before importing TrayManager
vi.mock('electron', () => {
  const mockTrayInstance = createMockTrayInstance();
  const MockTray = vi.fn().mockImplementation(() => mockTrayInstance);
  return {
    Tray: MockTray,
    Menu: {
      buildFromTemplate: mockBuildFromTemplate,
    },
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
    },
  };
});

describe('TrayManager', () => {
  let TrayManager: typeof import('../../src/main/TrayManager.js').TrayManager;
  let electron: typeof import('electron');
  let mockTrayInstance: ReturnType<typeof createMockTrayInstance>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Import the mocked electron
    electron = await import('electron');

    // Setup fresh mock instance
    mockTrayInstance = createMockTrayInstance();
    (electron.Tray as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockTrayInstance);
    mockBuildFromTemplate.mockReturnValue({ items: [] });

    // Import TrayManager after mocks are set up
    const module = await import('../../src/main/TrayManager.js');
    TrayManager = module.TrayManager;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('create', () => {
    it('should create Tray with icon path', () => {
      const manager = new TrayManager();
      manager.create();

      expect(electron.Tray).toHaveBeenCalled();
    });

    it('should return the created Tray instance', () => {
      const manager = new TrayManager();
      const tray = manager.create();

      expect(tray).toBe(mockTrayInstance);
    });
  });

  describe('updateMenu', () => {
    it('should call Menu.buildFromTemplate with an array', () => {
      const manager = new TrayManager();
      manager.create();
      manager.updateMenu([]);

      expect(mockBuildFromTemplate).toHaveBeenCalledWith(expect.any(Array));
    });

    it('should set context menu on tray', () => {
      const mockMenu = { items: [] };
      mockBuildFromTemplate.mockReturnValue(mockMenu);

      const manager = new TrayManager();
      manager.create();
      manager.updateMenu([]);

      expect(mockTrayInstance.setContextMenu).toHaveBeenCalledWith(mockMenu);
    });

    it('should do nothing if tray not created', () => {
      const manager = new TrayManager();
      // Don't create tray
      expect(() => manager.updateMenu([])).not.toThrow();
      expect(mockBuildFromTemplate).not.toHaveBeenCalled();
    });
  });

  describe('session items', () => {
    it('should include session items in menu', () => {
      const sessions = [
        { id: 'session-1', name: 'Session 1', status: 'active' as const },
        { id: 'session-2', name: 'Session 2', status: 'idle' as const },
      ];

      const manager = new TrayManager();
      manager.create();
      manager.updateMenu(sessions);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const sessionItems = template.filter(
        (item: { id?: string }) => item.id?.startsWith('session-')
      );

      expect(sessionItems).toHaveLength(2);
    });

    it('should show active status indicator for active sessions', () => {
      const sessions = [
        { id: 'session-1', name: 'Session 1', status: 'active' as const },
      ];

      const manager = new TrayManager();
      manager.create();
      manager.updateMenu(sessions);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const sessionItem = template.find(
        (item: { id?: string }) => item.id === 'session-1'
      );

      expect(sessionItem.label).toContain('●'); // Active indicator
    });

    it('should show idle status indicator for idle sessions', () => {
      const sessions = [
        { id: 'session-1', name: 'Session 1', status: 'idle' as const },
      ];

      const manager = new TrayManager();
      manager.create();
      manager.updateMenu(sessions);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const sessionItem = template.find(
        (item: { id?: string }) => item.id === 'session-1'
      );

      expect(sessionItem.label).toContain('○'); // Idle indicator
    });
  });

  describe('standard menu items', () => {
    it('should include New Session item', () => {
      const manager = new TrayManager();
      manager.create();
      manager.updateMenu([]);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const newSessionItem = template.find(
        (item: { label?: string }) => item.label === 'New Session'
      );

      expect(newSessionItem).toBeDefined();
    });

    it('should include Settings item', () => {
      const manager = new TrayManager();
      manager.create();
      manager.updateMenu([]);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const settingsItem = template.find(
        (item: { label?: string }) => item.label === 'Settings'
      );

      expect(settingsItem).toBeDefined();
    });

    it('should include Show/Hide item', () => {
      const manager = new TrayManager();
      manager.create();
      manager.updateMenu([]);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const showHideItem = template.find(
        (item: { label?: string }) => item.label === 'Show/Hide'
      );

      expect(showHideItem).toBeDefined();
    });

    it('should include Quit item', () => {
      const manager = new TrayManager();
      manager.create();
      manager.updateMenu([]);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const quitItem = template.find(
        (item: { label?: string }) => item.label === 'Quit'
      );

      expect(quitItem).toBeDefined();
    });
  });

  describe('menu separators', () => {
    it('should have separator after sessions section', () => {
      const sessions = [
        { id: 'session-1', name: 'Session 1', status: 'active' as const },
      ];

      const manager = new TrayManager();
      manager.create();
      manager.updateMenu(sessions);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const separators = template.filter(
        (item: { type?: string }) => item.type === 'separator'
      );

      expect(separators.length).toBeGreaterThanOrEqual(1);
    });

    it('should have separator before Quit item', () => {
      const manager = new TrayManager();
      manager.create();
      manager.updateMenu([]);

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const quitIndex = template.findIndex(
        (item: { label?: string }) => item.label === 'Quit'
      );
      const beforeQuit = template[quitIndex - 1];

      expect(beforeQuit.type).toBe('separator');
    });
  });

  describe('tray click', () => {
    it('should register click handler on tray', () => {
      const manager = new TrayManager();
      manager.create();

      expect(mockTrayInstance.on).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should call onToggleWindow callback when tray is clicked', () => {
      const onToggle = vi.fn();
      const manager = new TrayManager();
      manager.create(onToggle);

      // Get the click handler that was registered
      const clickCall = mockTrayInstance.on.mock.calls.find(
        (call: [string, () => void]) => call[0] === 'click'
      );
      const clickHandler = clickCall?.[1];

      // Simulate click
      clickHandler?.();

      expect(onToggle).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should call destroy on tray', () => {
      const manager = new TrayManager();
      manager.create();
      manager.destroy();

      expect(mockTrayInstance.destroy).toHaveBeenCalled();
    });

    it('should do nothing if tray not created', () => {
      const manager = new TrayManager();
      // Don't create tray
      expect(() => manager.destroy()).not.toThrow();
    });

    it('should set tray to null after destroy', () => {
      const manager = new TrayManager();
      manager.create();
      manager.destroy();

      expect(manager.getTray()).toBeNull();
    });
  });

  describe('getTray', () => {
    it('should return the tray after creation', () => {
      const manager = new TrayManager();
      manager.create();

      const tray = manager.getTray();

      expect(tray).toBe(mockTrayInstance);
    });

    it('should return null before tray is created', () => {
      const manager = new TrayManager();

      const tray = manager.getTray();

      expect(tray).toBeNull();
    });
  });
});
