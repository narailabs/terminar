/**
 * Sidebar position — persists whether the sidebar is on the left or right side.
 */

export type SidebarPosition = 'left' | 'right';

const STORAGE_KEY = 'sidebar-position';

function load(): SidebarPosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'left' || raw === 'right') return raw;
  } catch { /* ignore */ }
  return 'right';
}

function save(pos: SidebarPosition): void {
  try {
    localStorage.setItem(STORAGE_KEY, pos);
  } catch { /* ignore */ }
}

let position = $state<SidebarPosition>(load());

export const sidebarPositionStore = {
  get value() { return position; },
  set(pos: SidebarPosition) { position = pos; save(pos); },
  toggle() {
    const next = position === 'right' ? 'left' : 'right';
    position = next;
    save(next);
  },
};
