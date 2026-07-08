import type { Workspace } from './workspaceTypes';

let baseUrl = 'http://localhost:6750';

export function setWorkspaceApiBaseUrl(url: string) {
  baseUrl = url;
}

/** Overrides loadWorkspace()/saveWorkspace() to go over a different
 *  transport (e.g. the tray's Unix-socket RPC) instead of HTTP `fetch`. */
export interface WorkspaceTransport {
  get(): Promise<Workspace | null>;
  put(workspace: Workspace): Promise<void>;
}
let _transportOverride: WorkspaceTransport | null = null;

export function setWorkspaceTransport(transport: WorkspaceTransport | null): void {
  _transportOverride = transport;
}

/** Load the saved workspace layout from the server, if any. */
export async function loadWorkspace(): Promise<Workspace | null> {
  if (_transportOverride) {
    try {
      return await _transportOverride.get();
    } catch (e) {
      console.warn('[WorkspaceAPI] Transport failed to load workspace:', e);
      return null;
    }
  }
  try {
    const response = await fetch(`${baseUrl}/workspace`);
    if (response.ok) {
      const data = await response.json();
      return data.workspace || null;
    }
  } catch (e) {
    console.warn('[WorkspaceAPI] Failed to load workspace from server:', e);
  }
  return null;
}

/** Save the current workspace layout to the server. */
export async function saveWorkspace(workspace: Workspace): Promise<void> {
  if (_transportOverride) return _transportOverride.put(workspace);
  try {
    await fetch(`${baseUrl}/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, templates: [] }),
    });
  } catch (e) {
    console.error('[WorkspaceAPI] Failed to save workspace:', e);
  }
}
