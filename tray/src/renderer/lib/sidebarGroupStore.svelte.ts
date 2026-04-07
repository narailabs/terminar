/**
 * Sidebar groups — organize terminals into named groups, independent of tabs.
 * Every session must belong to exactly one group (default: "Ungrouped").
 */

export interface SidebarGroup {
  id: string;
  name: string;
  sessionIds: string[];
  collapsed: boolean;
}

export const DEFAULT_GROUP_ID = '__default__';

const STORAGE_KEY = 'sidebar-groups';

function ensureDefaultGroup(groups: SidebarGroup[]): SidebarGroup[] {
  if (groups.some(g => g.id === DEFAULT_GROUP_ID)) return groups;
  return [{ id: DEFAULT_GROUP_ID, name: 'Ungrouped', sessionIds: [], collapsed: false }, ...groups];
}

function load(): SidebarGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return ensureDefaultGroup(JSON.parse(raw));
  } catch { /* ignore */ }
  return ensureDefaultGroup([]);
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

  /** Get the group a session belongs to, or null */
  getGroupForSession(sessionId: string): SidebarGroup | null {
    return groups.find(g => g.sessionIds.includes(sessionId)) ?? null;
  },

  /** Ensure a session belongs to a group; if not, add to default group. */
  ensureSessionInGroup(sessionId: string): void {
    if (groups.some(g => g.sessionIds.includes(sessionId))) return;
    this.addSession(DEFAULT_GROUP_ID, sessionId);
  },
};
