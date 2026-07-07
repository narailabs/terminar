/**
 * Tracks whether this app window currently has OS focus, so the UI can dim its
 * chrome when the user switches away (à la an inactive Chrome window).
 *
 * Renderer-only: an Electron renderer receives window focus/blur just like a
 * browser tab, so DOM events are authoritative for both the tray app and the
 * standalone web build — no main-process/IPC plumbing required.
 */

let focused = $state(true);

export const windowFocus = {
  get focused() {
    return focused;
  },
};

let initialized = false;

export function initWindowFocus(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  focused = document.hasFocus();
  window.addEventListener('focus', () => {
    focused = true;
  });
  window.addEventListener('blur', () => {
    focused = false;
  });
}
