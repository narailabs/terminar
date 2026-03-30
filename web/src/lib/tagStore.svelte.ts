/**
 * Terminal session tags — colored labels for organizing terminals.
 */

export interface Tag {
  name: string;
  color: string; // hex color
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

function loadTags(): Map<string, Tag[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Map(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Map();
}

function saveTags(tags: Map<string, Tag[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...tags]));
  } catch { /* ignore */ }
}

let tags = $state<Map<string, Tag[]>>(loadTags());

function persist() {
  saveTags(tags);
}

export const tagStore = {
  get tags() { return tags; },

  getTags(sessionId: string): Tag[] {
    return tags.get(sessionId) ?? [];
  },

  addTag(sessionId: string, tag: Tag): void {
    const current = tags.get(sessionId) ?? [];
    if (current.some(t => t.name === tag.name)) return;
    tags = new Map(tags).set(sessionId, [...current, tag]);
    persist();
  },

  removeTag(sessionId: string, tagName: string): void {
    const current = tags.get(sessionId);
    if (!current) return;
    const filtered = current.filter(t => t.name !== tagName);
    const next = new Map(tags);
    if (filtered.length === 0) next.delete(sessionId);
    else next.set(sessionId, filtered);
    tags = next;
    persist();
  },

  clearTags(sessionId: string): void {
    if (!tags.has(sessionId)) return;
    const next = new Map(tags);
    next.delete(sessionId);
    tags = next;
    persist();
  },

  /** All unique tag names used across sessions, for autocomplete */
  get allTagNames(): string[] {
    const names = new Set<string>();
    for (const list of tags.values()) {
      for (const t of list) names.add(t.name);
    }
    return [...names].sort();
  },
};
