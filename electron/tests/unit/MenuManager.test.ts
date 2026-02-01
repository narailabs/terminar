import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Mock Menu.buildFromTemplate and Menu.setApplicationMenu
const mockBuildFromTemplate = vi.fn();
const mockSetApplicationMenu = vi.fn();

// Mock electron before importing MenuManager
vi.mock('electron', () => {
  return {
    Menu: {
      buildFromTemplate: mockBuildFromTemplate,
      setApplicationMenu: mockSetApplicationMenu,
    },
  };
});

describe('MenuManager', () => {
  let MenuManager: typeof import('../../src/main/MenuManager.js').MenuManager;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Setup mock to return a mock menu object
    mockBuildFromTemplate.mockReturnValue({ items: [] });

    // Import MenuManager after mocks are set up
    const module = await import('../../src/main/MenuManager.js');
    MenuManager = module.MenuManager;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('buildMenu', () => {
    it('should call Menu.buildFromTemplate with an array', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      expect(mockBuildFromTemplate).toHaveBeenCalledWith(expect.any(Array));
    });

    it('should return the built menu', () => {
      const mockMenu = { items: [] };
      mockBuildFromTemplate.mockReturnValue(mockMenu);

      const manager = new MenuManager();
      const result = manager.buildMenu();

      expect(result).toBe(mockMenu);
    });
  });

  describe('File menu', () => {
    it('should contain New Session item', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const fileMenu = template.find((m: { label?: string }) => m.label === 'File');

      expect(fileMenu).toBeDefined();
      const newSessionItem = fileMenu.submenu.find((item: { label?: string }) => item.label === 'New Session');
      expect(newSessionItem).toBeDefined();
    });

    it('should contain Connect item', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const fileMenu = template.find((m: { label?: string }) => m.label === 'File');

      expect(fileMenu).toBeDefined();
      const connectItem = fileMenu.submenu.find((item: { label?: string }) => item.label === 'Connect');
      expect(connectItem).toBeDefined();
    });

    it('should contain Settings item', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const fileMenu = template.find((m: { label?: string }) => m.label === 'File');

      expect(fileMenu).toBeDefined();
      const settingsItem = fileMenu.submenu.find((item: { label?: string }) => item.label === 'Settings');
      expect(settingsItem).toBeDefined();
    });

    it('should contain Quit item', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const fileMenu = template.find((m: { label?: string }) => m.label === 'File');

      expect(fileMenu).toBeDefined();
      const quitItem = fileMenu.submenu.find((item: { role?: string }) => item.role === 'quit');
      expect(quitItem).toBeDefined();
    });
  });

  describe('Edit menu', () => {
    it('should contain Copy item with role', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const editMenu = template.find((m: { label?: string }) => m.label === 'Edit');

      expect(editMenu).toBeDefined();
      const copyItem = editMenu.submenu.find((item: { role?: string }) => item.role === 'copy');
      expect(copyItem).toBeDefined();
    });

    it('should contain Paste item with role', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const editMenu = template.find((m: { label?: string }) => m.label === 'Edit');

      expect(editMenu).toBeDefined();
      const pasteItem = editMenu.submenu.find((item: { role?: string }) => item.role === 'paste');
      expect(pasteItem).toBeDefined();
    });

    it('should contain Select All item with role', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const editMenu = template.find((m: { label?: string }) => m.label === 'Edit');

      expect(editMenu).toBeDefined();
      const selectAllItem = editMenu.submenu.find((item: { role?: string }) => item.role === 'selectAll');
      expect(selectAllItem).toBeDefined();
    });
  });

  describe('View menu', () => {
    it('should contain Zoom In item with role', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const viewMenu = template.find((m: { label?: string }) => m.label === 'View');

      expect(viewMenu).toBeDefined();
      const zoomInItem = viewMenu.submenu.find((item: { role?: string }) => item.role === 'zoomIn');
      expect(zoomInItem).toBeDefined();
    });

    it('should contain Zoom Out item with role', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const viewMenu = template.find((m: { label?: string }) => m.label === 'View');

      expect(viewMenu).toBeDefined();
      const zoomOutItem = viewMenu.submenu.find((item: { role?: string }) => item.role === 'zoomOut');
      expect(zoomOutItem).toBeDefined();
    });

    it('should contain Reset Zoom item with role', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const viewMenu = template.find((m: { label?: string }) => m.label === 'View');

      expect(viewMenu).toBeDefined();
      const resetZoomItem = viewMenu.submenu.find((item: { role?: string }) => item.role === 'resetZoom');
      expect(resetZoomItem).toBeDefined();
    });

    it('should contain Toggle Full Screen item with role', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const viewMenu = template.find((m: { label?: string }) => m.label === 'View');

      expect(viewMenu).toBeDefined();
      const toggleFullScreenItem = viewMenu.submenu.find((item: { role?: string }) => item.role === 'togglefullscreen');
      expect(toggleFullScreenItem).toBeDefined();
    });
  });

  describe('Help menu', () => {
    it('should contain About item', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const helpMenu = template.find((m: { label?: string }) => m.label === 'Help');

      expect(helpMenu).toBeDefined();
      const aboutItem = helpMenu.submenu.find((item: { label?: string }) => item.label === 'About');
      expect(aboutItem).toBeDefined();
    });
  });

  describe('keyboard accelerators', () => {
    it('should have CommandOrControl+N for New Session', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const fileMenu = template.find((m: { label?: string }) => m.label === 'File');
      const newSessionItem = fileMenu.submenu.find((item: { label?: string }) => item.label === 'New Session');

      expect(newSessionItem.accelerator).toBe('CommandOrControl+N');
    });

    it('should have CommandOrControl+, for Settings', () => {
      const manager = new MenuManager();
      manager.buildMenu();

      const template = mockBuildFromTemplate.mock.calls[0][0];
      const fileMenu = template.find((m: { label?: string }) => m.label === 'File');
      const settingsItem = fileMenu.submenu.find((item: { label?: string }) => item.label === 'Settings');

      expect(settingsItem.accelerator).toBe('CommandOrControl+,');
    });
  });

  describe('setApplicationMenu', () => {
    it('should call Menu.setApplicationMenu with the built menu', () => {
      const mockMenu = { items: [] };
      mockBuildFromTemplate.mockReturnValue(mockMenu);

      const manager = new MenuManager();
      manager.setApplicationMenu();

      expect(mockSetApplicationMenu).toHaveBeenCalledWith(mockMenu);
    });

    it('should build menu if not already built', () => {
      const mockMenu = { items: [] };
      mockBuildFromTemplate.mockReturnValue(mockMenu);

      const manager = new MenuManager();
      manager.setApplicationMenu();

      expect(mockBuildFromTemplate).toHaveBeenCalled();
      expect(mockSetApplicationMenu).toHaveBeenCalledWith(mockMenu);
    });

    it('should reuse existing menu if already built', () => {
      const mockMenu = { items: [] };
      mockBuildFromTemplate.mockReturnValue(mockMenu);

      const manager = new MenuManager();
      manager.buildMenu();
      manager.setApplicationMenu();

      // buildFromTemplate should only be called once
      expect(mockBuildFromTemplate).toHaveBeenCalledTimes(1);
      expect(mockSetApplicationMenu).toHaveBeenCalledWith(mockMenu);
    });
  });
});
