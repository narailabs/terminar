// @narai/terminar-ui - Reusable terminal UI components

// === Types ===
export type { TerminalSettings, TerminalTheme } from './lib/types';
export type { SessionManager, SessionInfo, ConnectionState } from './lib/SessionManager';
export type {
  Pane,
  PaneId,
  TabId,
  SessionId,
  SplitContainer,
  SplitNode,
  SplitDirection,
  DropZone,
  Tab,
  Workspace,
  LayoutTemplate,
} from './lib/workspaceTypes';

// === Utilities ===
export { TerminalResizeDebouncer } from './lib/TerminalResizeDebouncer';
export {
  createPane,
  createSplit,
  createTab,
  createDefaultWorkspace,
  findPane,
  findParent,
  getAllPanes,
  getWorkspaceSessionIds,
} from './lib/workspaceTypes';

// === Components (import to register custom elements) ===
// Usage: import '@narai/terminar-ui/components';
// Then use <terminar-terminal>, <terminar-split>, <terminar-split-handle> in HTML
