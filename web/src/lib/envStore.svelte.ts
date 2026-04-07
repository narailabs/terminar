/**
 * localStorage key for persisting global environment variables
 */
export const ENV_STORAGE_KEY = 'terminar-env-vars';

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

let vars = $state<Record<string, string>>(loadFromStorage());

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
 * Get the effective environment variables by merging global vars with
 * per-session overrides. Session overrides take precedence over global vars.
 */
export function getEffectiveEnv(sessionOverrides?: Record<string, string>): Record<string, string> {
  return { ...vars, ...(sessionOverrides || {}) };
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
}
