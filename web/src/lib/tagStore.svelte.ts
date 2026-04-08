/**
 * Terminal session tags — colored labels for organizing terminals.
 *
 * Tags use a normalized model: definitions (global registry) + assignments (per-session).
 * Two-tier persistence: localStorage (immediate) + server (debounced 500ms).
 */

export interface Tag {
  name: string;
  color: string;       // hex — background color
  fontColor?: string;  // hex — text color (falls back to contrastColor when undefined)
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
const DEFAULT_STATE: TagState = {
  definitions: [
    { id: '427e80c6-48c0-4654-947e-34d2a726ad6e', name: 'Important', color: '#e06c75', fontColor: '#ffe5e5' },
    { id: 'cd62cfa8-e052-4f60-b354-6a27a11bb3f8', name: 'Follow-up', color: '#e5c07b', fontColor: '#750000' },
    { id: 'd0d618fd-6836-4d8c-a110-75eb5829a97c', name: 'Waiting for response', color: '#61afef' },
  ],
  assignments: {},
};

/**
 * Detect and migrate old format: [[sessionId, Tag[]], ...] → TagState
 */
function migrateOldFormat(raw: unknown): TagState | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return DEFAULT_STATE;
  // Old format: array of [string, Tag[]] tuples
  if (!Array.isArray(raw[0]) || typeof raw[0][0] !== 'string') return null;

  const defMap = new Map<string, TagDefinition>(); // name → def
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
let serverSaveCallback: ((tags: TagState) => Promise<void>) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(s: TagState) {
  saveToLocalStorage(s);
  if (!serverSaveCallback) return;
  if (saveTimer) clearTimeout(saveTimer);
  const cb = serverSaveCallback;
  saveTimer = setTimeout(async () => {
    try {
      await cb(s);
    } catch (e) {
      console.warn('[TagStore] Server save failed:', e);
    }
  }, 500);
}

function updateState(newState: TagState) {
  state = newState;
  scheduleSave(state);
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

function setSaveCallback(callback: (tags: TagState) => Promise<void>) {
  serverSaveCallback = callback;
}

function initialize(serverTags: TagState | null) {
  if (serverTags && isTagState(serverTags)) {
    state = serverTags;
    saveToLocalStorage(state);
  }
  // If server has no data, keep current localStorage state and push to server
  else if (serverSaveCallback && state.definitions.length > 0) {
    serverSaveCallback(state).catch(e =>
      console.warn('[TagStore] Initial server push failed:', e)
    );
  }
}

export const tagStoreApi = { initialize, setSaveCallback };
