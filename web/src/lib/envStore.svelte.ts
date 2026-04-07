/**
 * localStorage key for persisting global environment variables
 */
export const ENV_STORAGE_KEY = 'terminar-env-vars';

/**
 * localStorage key for persisting per-session environment variables
 */
export const SESSION_ENV_STORAGE_KEY = 'terminar-session-env-vars';

/**
 * Load env vars from localStorage
 */
function loadFromStorage(): Record<string, string> {
  try {
    const stored = localStorage.getItem(ENV_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[EnvStore] Failed to load from localStorage:', e);
  }
  return {};
}

/**
 * Save env vars to localStorage
 */
function saveToStorage(vars: Record<string, string>): void {
  try {
    localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(vars));
  } catch (e) {
    console.warn('[EnvStore] Failed to save to localStorage:', e);
  }
}

/**
 * Load per-session env vars from localStorage
 */
function loadSessionVarsFromStorage(): Record<string, Record<string, string>> {
  try {
    const stored = localStorage.getItem(SESSION_ENV_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[EnvStore] Failed to load session vars from localStorage:', e);
  }
  return {};
}

/**
 * Save per-session env vars to localStorage
 */
function saveSessionVarsToStorage(vars: Record<string, Record<string, string>>): void {
  try {
    localStorage.setItem(SESSION_ENV_STORAGE_KEY, JSON.stringify(vars));
  } catch (e) {
    console.warn('[EnvStore] Failed to save session vars to localStorage:', e);
  }
}

let vars = $state<Record<string, string>>(loadFromStorage());
let sessionVars = $state<Record<string, Record<string, string>>>(loadSessionVarsFromStorage());

/**
 * Global environment variables store.
 * These are applied to all new sessions and persisted to localStorage.
 */
export const globalEnvVars = {
  get value() {
    return vars;
  },
};

/**
 * Per-session environment variables store.
 */
export const sessionEnvVars = {
  get value() {
    return sessionVars;
  },
};

/**
 * Add a new environment variable to the global store.
 */
export function addEnvVar(key: string, value: string): void {
  const updated = { ...vars, [key]: value };
  saveToStorage(updated);
  vars = updated;
}

/**
 * Update an existing environment variable value.
 */
export function updateEnvVar(key: string, value: string): void {
  const updated = { ...vars, [key]: value };
  saveToStorage(updated);
  vars = updated;
}

/**
 * Delete an environment variable from the global store.
 */
export function deleteEnvVar(key: string): void {
  const updated = { ...vars };
  delete updated[key];
  saveToStorage(updated);
  vars = updated;
}

/**
 * Add a per-session environment variable.
 */
export function addSessionEnvVar(sessionId: string, key: string, value: string): void {
  const sessionMap = { ...(sessionVars[sessionId] || {}), [key]: value };
  const updated = { ...sessionVars, [sessionId]: sessionMap };
  saveSessionVarsToStorage(updated);
  sessionVars = updated;
}

/**
 * Update a per-session environment variable.
 */
export function updateSessionEnvVar(sessionId: string, key: string, value: string): void {
  const sessionMap = { ...(sessionVars[sessionId] || {}), [key]: value };
  const updated = { ...sessionVars, [sessionId]: sessionMap };
  saveSessionVarsToStorage(updated);
  sessionVars = updated;
}

/**
 * Delete a per-session environment variable.
 */
export function deleteSessionEnvVar(sessionId: string, key: string): void {
  const sessionMap = { ...(sessionVars[sessionId] || {}) };
  delete sessionMap[key];
  const updated = { ...sessionVars, [sessionId]: sessionMap };
  if (Object.keys(sessionMap).length === 0) {
    delete updated[sessionId];
  }
  saveSessionVarsToStorage(updated);
  sessionVars = updated;
}

/**
 * Get env vars for a specific session (without global merge).
 */
export function getSessionEnvVars(sessionId: string): Record<string, string> {
  return sessionVars[sessionId] || {};
}

/**
 * Remove per-session env var entries for sessions that no longer exist.
 */
export function cleanStaleSessionEnvVars(activeSessionIds: Set<string>): void {
  let changed = false;
  const updated = { ...sessionVars };
  for (const id of Object.keys(updated)) {
    if (!activeSessionIds.has(id)) {
      delete updated[id];
      changed = true;
    }
  }
  if (changed) {
    saveSessionVarsToStorage(updated);
    sessionVars = updated;
  }
}

/**
 * Get the effective environment variables by merging global vars with
 * per-session vars. Per-session vars take precedence over global vars.
 */
export function getEffectiveEnv(sessionId?: string): Record<string, string> {
  if (!sessionId) return { ...vars };
  return { ...vars, ...(sessionVars[sessionId] || {}) };
}

/**
 * Validate an environment variable key.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateEnvKey(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return 'Key cannot be empty';
  }
  if (trimmed.includes(' ')) {
    return 'Key cannot contain spaces';
  }
  if (trimmed.includes('=')) {
    return 'Key cannot contain "="';
  }
  return null;
}

/**
 * Reset the env vars store (reload from localStorage).
 * Useful for testing and re-initialization.
 */
export function resetEnvVars(): void {
  vars = loadFromStorage();
  sessionVars = loadSessionVarsFromStorage();
}
