/**
 * Terminal session tags — colored labels for organizing terminals.
 *
 * Tags use a normalized model: definitions (global registry) + assignments (per-session).
 * Tray version: localStorage-only persistence (no server sync).
 */

export interface Tag {
  name: string;
  color: string;       // hex — background color
  fontColor?: string;  // hex — text color (falls back to tag.color when undefined)
}

export interface TagDefinition {
  id: string;          // crypto.randomUUID()
  name: string;
  color: string;       // hex — background color
  fontColor?: string;  // hex — text color
}

export interface TagState {
  definitions: TagDefinition[];
  assignments: Record<string, string[]>; // sessionId -> tagDefinitionId[]
}

export const TAG_COLORS = [
  '#e06c75', // red
  '#e5c07b', // yellow
  '#98c379', // green
  '#56b6c2', // cyan
  '#61afef', // blue
  '#c678dd', // purple
  '#d19a66', // orange
  '#be5046', // dark red
  '#7ec699', // mint
  '#e06ca0', // pink
  '#5c6370', // gray
  '#abb2bf', // silver
] as const;

const STORAGE_KEY = 'terminal-tags';
const DEFAULT_STATE: TagState = { definitions: [], assignments: {} };

/**
 * Detect and migrate old format: [[sessionId, Tag[]], ...] → TagState
 */
function migrateOldFormat(raw: unknown): TagState | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return DEFAULT_STATE;
  if (!Array.isArray(raw[0]) || typeof raw[0][0] !== 'string') return null;

  const defMap = new Map<string, TagDefinition>();
  const assignments: Record<string, string[]> = {};

  for (const [sessionId, tags] of raw as [string, Tag[]][]) {
    const ids: string[] = [];
    for (const t of tags) {
      const key = t.name;
      if (!defMap.has(key)) {
        defMap.set(key, { id: crypto.randomUUID(), name: t.name, color: t.color });
      }
      ids.push(defMap.get(key)!.id);
    }
    if (ids.length > 0) {
      assignments[sessionId] = ids;
    }
  }

  return { definitions: [...defMap.values()], assignments };
}

function isTagState(raw: unknown): raw is TagState {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return Array.isArray(obj.definitions) && typeof obj.assignments === 'object' && obj.assignments !== null;
}

function loadState(): TagState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    if (isTagState(parsed)) return parsed;
    const migrated = migrateOldFormat(parsed);
    if (migrated) return migrated;
  } catch { /* ignore */ }
  return DEFAULT_STATE;
}

function saveToLocalStorage(s: TagState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

let state = $state<TagState>(loadState());

function persist(s: TagState) {
  saveToLocalStorage(s);
}

function updateState(newState: TagState) {
  state = newState;
  persist(state);
}

export const tagStore = {
  get state() { return state; },

  get definitions(): TagDefinition[] {
    return state.definitions;
  },

  /** Resolve a session's assigned tag IDs into Tag objects for rendering */
  getTagsForSession(sessionId: string): Tag[] {
    const ids = state.assignments[sessionId];
    if (!ids || ids.length === 0) return [];
    const defMap = new Map(state.definitions.map(d => [d.id, d]));
    return ids
      .map(id => defMap.get(id))
      .filter((d): d is TagDefinition => d !== undefined)
      .map(d => ({ name: d.name, color: d.color, fontColor: d.fontColor }));
  },

  getAssignedIds(sessionId: string): string[] {
    return state.assignments[sessionId] ?? [];
  },

  isTagAssigned(sessionId: string, tagId: string): boolean {
    return (state.assignments[sessionId] ?? []).includes(tagId);
  },

  toggleTagAssignment(sessionId: string, tagId: string): void {
    const current = state.assignments[sessionId] ?? [];
    const newAssignments = { ...state.assignments };
    if (current.includes(tagId)) {
      const filtered = current.filter(id => id !== tagId);
      if (filtered.length === 0) delete newAssignments[sessionId];
      else newAssignments[sessionId] = filtered;
    } else {
      newAssignments[sessionId] = [...current, tagId];
    }
    updateState({ ...state, assignments: newAssignments });
  },

  addDefinition(name: string, color: string, fontColor?: string): TagDefinition {
    const def: TagDefinition = { id: crypto.randomUUID(), name, color, ...(fontColor ? { fontColor } : {}) };
    updateState({ ...state, definitions: [...state.definitions, def] });
    return def;
  },

  updateDefinition(id: string, name: string, color: string, fontColor?: string): void {
    const definitions = state.definitions.map(d =>
      d.id === id ? { ...d, name, color, fontColor } : d
    );
    updateState({ ...state, definitions });
  },

  deleteDefinition(id: string): void {
    const definitions = state.definitions.filter(d => d.id !== id);
    const assignments: Record<string, string[]> = {};
    for (const [sessionId, ids] of Object.entries(state.assignments)) {
      const filtered = ids.filter(tid => tid !== id);
      if (filtered.length > 0) assignments[sessionId] = filtered;
    }
    updateState({ definitions, assignments });
  },

  clearAssignments(sessionId: string): void {
    if (!state.assignments[sessionId]) return;
    const assignments = { ...state.assignments };
    delete assignments[sessionId];
    updateState({ ...state, assignments });
  },

  /** All unique tag names used across definitions, for autocomplete */
  get allTagNames(): string[] {
    return state.definitions.map(d => d.name).sort();
  },
};
