const SESSION_LIST_KEY = 'terminar-session-list';

export interface SessionSummary {
  id: string;
  name: string;
}

export function writeSessionList(sessions: SessionSummary[]): void {
  try {
    localStorage.setItem(SESSION_LIST_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[SessionListStore] Failed to write:', e);
  }
}

export function readSessionList(): SessionSummary[] {
  try {
    const stored = localStorage.getItem(SESSION_LIST_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[SessionListStore] Failed to read:', e);
  }
  return [];
}
