import { mount } from 'svelte';
import App from '../../../web/src/App.svelte';
import { WebSocketSessionManager } from '../../../web/src/lib/WebSocketSessionManager';

/**
 * Renderer entry point for the Electron app.
 * - Mounts the Svelte App to the #app element
 * - Hooks into WebSocketSessionManager sessionList events
 * - Notifies main process of session changes via electronAPI
 */

// Mount the Svelte app to the target element
const target = document.getElementById('app')!;
const app = mount(App, { target });

// Create a WebSocketSessionManager instance to hook into session events
// The actual connection happens within the App component, but we create
// a reference here to hook into session list changes for electron IPC
const manager = new WebSocketSessionManager('ws://localhost:6749/ws');

// Hook into session list changes and notify main process
manager.on('sessionList', (sessions: unknown[]) => {
  // Gracefully handle missing electronAPI (for web-only mode)
  if (typeof window !== 'undefined' && window.electronAPI?.notifySessionsChanged) {
    window.electronAPI.notifySessionsChanged(sessions as any);
  }
});

export { app, manager };
