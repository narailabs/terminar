/**
 * Sidebar groups — organize terminals into named groups, independent of tabs.
 * A session can exist in at most one group, or be ungrouped.
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

const STORAGE_KEY = 'sidebar-groups';

function load(): SidebarGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function save(groups: SidebarGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch { /* ignore */ }
}

let groups = $state<SidebarGroup[]>(load());

function persist() {
  save(groups);
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

  removeSession(sessionId: string): void {
    groups = groups.map(g => {
      if (!g.sessionIds.includes(sessionId)) return g;
      return { ...g, sessionIds: g.sessionIds.filter(id => id !== sessionId) };
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
};
