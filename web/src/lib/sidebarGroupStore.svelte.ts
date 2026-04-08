/**
 * Sidebar groups — organize terminals into named groups, independent of tabs.
 * Every session must belong to exactly one group (default: "Ungrouped").
 */

export interface SidebarGroup {
  id: string;
  name: string;
  sessionIds: string[];
  collapsed: boolean;
  sidebarTextColor?: string;
  titlebarBg?: string;
  titlebarFg?: string;
}

export const DEFAULT_GROUP_ID = '__default__';

const STORAGE_KEY = 'sidebar-groups';
const UNGROUPED_ORDER_KEY = 'sidebar-ungrouped-order';

const DEFAULT_GROUPS: SidebarGroup[] = [
  { id: DEFAULT_GROUP_ID, name: 'Ungrouped', sessionIds: [], collapsed: false },
  { id: 'ac341aba-35f9-4a25-b5c7-ffda778f7201', name: 'Todo', sessionIds: [], collapsed: false, sidebarTextColor: '#676767', titlebarBg: '#676767', titlebarFg: '#e3e3e3' },
  { id: '8ef3ffb2-77d5-4505-8ae9-bd69c8764e3c', name: 'In-Progress', sessionIds: [], collapsed: false, sidebarTextColor: '#5a88c4', titlebarBg: '#5a88c4', titlebarFg: '#f0f1ff' },
  { id: 'd17d4128-10af-4ed8-a1b2-95007afaf621', name: 'In-Review', sessionIds: [], collapsed: false, sidebarTextColor: '#cc7b30', titlebarBg: '#cc7b30', titlebarFg: '#fff4e5' },
  { id: 'ada11281-a6bb-49ee-8de9-ef11d2c91048', name: 'Complete', sessionIds: [], collapsed: false, sidebarTextColor: '#4a944c', titlebarBg: '#4a944c', titlebarFg: '#d1ffe3' },
];

function ensureDefaultGroup(groups: SidebarGroup[]): SidebarGroup[] {
  if (groups.some(g => g.id === DEFAULT_GROUP_ID)) return groups;
  return [{ id: DEFAULT_GROUP_ID, name: 'Ungrouped', sessionIds: [], collapsed: false }, ...groups];
}

function load(): SidebarGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return ensureDefaultGroup(JSON.parse(raw));
  } catch { /* ignore */ }
  return DEFAULT_GROUPS;
}

function save(groups: SidebarGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch { /* ignore */ }
}

function loadUngroupedOrder(): string[] {
  try {
    const raw = localStorage.getItem(UNGROUPED_ORDER_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveUngroupedOrder(order: string[]): void {
  try {
    localStorage.setItem(UNGROUPED_ORDER_KEY, JSON.stringify(order));
  } catch { /* ignore */ }
}

let groups = $state<SidebarGroup[]>(load());
let ungroupedOrder = $state<string[]>(loadUngroupedOrder());

function persist() {
  save(groups);
}

function persistUngrouped() {
  saveUngroupedOrder(ungroupedOrder);
}

export const sidebarGroupStore = {
  get groups() { return groups; },

  createGroup(name: string): string {
    const id = crypto.randomUUID();
    groups = [...groups, { id, name, sessionIds: [], collapsed: false }];
    persist();
    return id;
  },

  renameGroup(groupId: string, name: string): void {
    groups = groups.map(g => g.id === groupId ? { ...g, name } : g);
    persist();
  },

  deleteGroup(groupId: string): void {
    if (groupId === DEFAULT_GROUP_ID) return;
    const dying = groups.find(g => g.id === groupId);
    if (dying && dying.sessionIds.length > 0) {
      groups = groups.map(g =>
        g.id === DEFAULT_GROUP_ID
          ? { ...g, sessionIds: [...g.sessionIds, ...dying.sessionIds] }
          : g
      );
    }
    groups = groups.filter(g => g.id !== groupId);
    persist();
  },

  toggleCollapsed(groupId: string): void {
    groups = groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g);
    persist();
  },

  /** Add a session to a group. Removes from any other group first. */
  addSession(groupId: string, sessionId: string): void {
    groups = groups.map(g => {
      if (g.id === groupId) {
        if (g.sessionIds.includes(sessionId)) return g;
        return { ...g, sessionIds: [...g.sessionIds, sessionId] };
      }
      // Remove from other groups
      if (g.sessionIds.includes(sessionId)) {
        return { ...g, sessionIds: g.sessionIds.filter(id => id !== sessionId) };
      }
      return g;
    });
    persist();
  },

  /** Add a session to a group at a specific index. Removes from any other group first. */
  addSessionAt(groupId: string, sessionId: string, index: number): void {
    groups = groups.map(g => {
      if (g.id !== groupId && g.sessionIds.includes(sessionId)) {
        return { ...g, sessionIds: g.sessionIds.filter(id => id !== sessionId) };
      }
      if (g.id === groupId) {
        const filtered = g.sessionIds.filter(id => id !== sessionId);
        filtered.splice(Math.min(index, filtered.length), 0, sessionId);
        return { ...g, sessionIds: filtered };
      }
      return g;
    });
    persist();
  },

  /** Remove a session from its group. Moves to default group instead of ungrouping. */
  removeSession(sessionId: string): void {
    const current = groups.find(g => g.sessionIds.includes(sessionId));
    if (!current || current.id === DEFAULT_GROUP_ID) return;
    groups = groups.map(g => {
      if (g.id === DEFAULT_GROUP_ID) {
        return { ...g, sessionIds: [...g.sessionIds, sessionId] };
      }
      if (g.sessionIds.includes(sessionId)) {
        return { ...g, sessionIds: g.sessionIds.filter(id => id !== sessionId) };
      }
      return g;
    });
    persist();
  },

  /** Move a session from one group to another */
  moveSession(sessionId: string, toGroupId: string): void {
    this.addSession(toGroupId, sessionId);
  },

  /** Reorder a session within its group */
  reorderInGroup(groupId: string, fromIndex: number, toIndex: number): void {
    groups = groups.map(g => {
      if (g.id !== groupId || fromIndex === toIndex) return g;
      const order = [...g.sessionIds];
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);
      return { ...g, sessionIds: order };
    });
    persist();
  },

  /** Reorder ungrouped sessions (stored as a special implicit list) */
  reorderGroups(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const reordered = [...groups];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    groups = reordered;
    persist();
  },

  updateGroupSettings(groupId: string, settings: Partial<Pick<SidebarGroup, 'name' | 'sidebarTextColor' | 'titlebarBg' | 'titlebarFg'>>): void {
    groups = groups.map(g => g.id === groupId ? { ...g, ...settings } : g);
    persist();
  },

  /** Get the group a session belongs to, or null */
  getGroupForSession(sessionId: string): SidebarGroup | null {
    return groups.find(g => g.sessionIds.includes(sessionId)) ?? null;
  },

  // ── Ungrouped session ordering ──────────────────────────────────────────
  get ungroupedOrder() { return ungroupedOrder; },

  setUngroupedOrder(ids: string[]): void {
    ungroupedOrder = ids;
    persistUngrouped();
  },

  reorderUngrouped(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const order = [...ungroupedOrder];
    const [moved] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, moved);
    ungroupedOrder = order;
    persistUngrouped();
  },

  /** Ensure a session belongs to a group; if not, add to default group. */
  ensureSessionInGroup(sessionId: string): void {
    if (groups.some(g => g.sessionIds.includes(sessionId))) return;
    this.addSession(DEFAULT_GROUP_ID, sessionId);
  },
};
