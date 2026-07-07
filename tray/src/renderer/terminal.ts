import { mount } from 'svelte';
import App from '../../../web/src/App.svelte';
import { setManagerFactory } from '../../../web/src/lib/connectionSingleton';
import { setSettingsTransport, type SettingsTransport } from '../../../web/src/lib/settingsApi';
import { setThemesTransport, type ThemesTransport } from '../../../web/src/lib/themesApi';
import { setTagsTransport, type TagsTransport } from '../../../web/src/lib/tagsApi';
import { setWorkspaceTransport, type WorkspaceTransport } from '../../../web/src/lib/workspaceApi';
import type { TerminalSettings } from '../../../web/src/lib/settingsStore.svelte';
import type { ThemeState } from '../../../web/src/lib/themeStore.svelte';
import type { TagState } from '../../../web/src/lib/tagStore.svelte';
import type { Workspace } from '../../../web/src/lib/workspaceTypes';
import { hasIpcSocket } from './lib/IpcSocket';
import { IpcSessionManager } from './lib/IpcSessionManager';

// In the tray's terminal window, the preload exposes `window.terminarSocket`
// (see tray/src/preload/terminal.ts) — a Unix-socket bridge through the
// Electron main process (tray/src/main/SocketBridge.ts), used instead of a
// real `ws://`/`fetch()` connection to close the network attack surface a
// TCP listener would otherwise expose. Plain browser tabs (pnpm dev:web)
// never see this global and are unaffected.
if (hasIpcSocket()) {
  setManagerFactory(() => new IpcSessionManager('', undefined));

  // Request a Rust ServerMessage type mapped to the ClientMessage `type` that
  // asks for it; unwraps to the raw JSON if the response type doesn't match
  // (mirrors the existing HTTP path's unchecked `as T` cast — see
  // packages/shell-protocol/src/messages.ts for the wire shapes).
  async function request(clientMessage: Record<string, unknown>): Promise<Record<string, unknown>> {
    const raw = await window.terminarSocket!.request(JSON.stringify(clientMessage));
    return JSON.parse(raw);
  }

  const settingsTransport: SettingsTransport = {
    async get() {
      const msg = await request({ type: 'get_settings' });
      return (msg.settings as TerminalSettings) ?? null;
    },
    async put(settings) {
      await request({ type: 'put_settings', settings });
    },
  };
  setSettingsTransport(settingsTransport);

  const themesTransport: ThemesTransport = {
    async get() {
      const msg = await request({ type: 'get_themes' });
      return (msg.value as ThemeState | null) ?? null;
    },
    async put(themes) {
      await request({ type: 'put_themes', value: themes });
    },
  };
  setThemesTransport(themesTransport);

  const tagsTransport: TagsTransport = {
    async get() {
      const msg = await request({ type: 'get_tags' });
      return (msg.value as TagState | null) ?? null;
    },
    async put(tags) {
      await request({ type: 'put_tags', value: tags });
    },
  };
  setTagsTransport(tagsTransport);

  const workspaceTransport: WorkspaceTransport = {
    async get() {
      const msg = await request({ type: 'get_workspace_state' });
      const state = msg.state as { workspace: Workspace } | undefined;
      return state?.workspace ?? null;
    },
    async put(workspace) {
      await request({
        type: 'put_workspace_state',
        state: { workspace, templates: [] },
      });
    },
  };
  setWorkspaceTransport(workspaceTransport);
}

const target = document.getElementById('app')!;
mount(App, { target });
