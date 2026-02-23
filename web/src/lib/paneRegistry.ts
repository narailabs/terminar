/**
 * Registry for Pane component instances, allowing parent components
 * to access pane methods (e.g., getSelection, pasteText, selectAll)
 * without threading refs through the recursive SplitContainer tree.
 */

export interface PaneHandle {
  getSelection(): string;
  pasteText(text: string): void;
  selectAll(): void;
  refreshTerminal?(): void;
  refit?(): void;
}

const registry = new Map<string, PaneHandle>();

export function registerPane(paneId: string, handle: PaneHandle) {
  registry.set(paneId, handle);
}

export function unregisterPane(paneId: string) {
  registry.delete(paneId);
}

export function getPane(paneId: string): PaneHandle | undefined {
  return registry.get(paneId);
}
