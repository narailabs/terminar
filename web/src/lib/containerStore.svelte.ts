import type { ContainerInfo } from './shared-protocol';

/** Key identifying a Docker host: `'local'` or an SSH connection ID. */
export type HostKey = string;
export const LOCAL_HOST: HostKey = 'local';

/**
 * Cache TTL for per-host container lists. SSH tunnel setup adds 300–800ms to
 * every remote `docker ps`, and users open the container picker repeatedly
 * during a session — refetching on every open is painful. 15s keeps the list
 * fresh enough to catch containers started in a nearby terminal without
 * re-tunneling each time. A manual "refresh" action (future) can bypass.
 */
const TTL_MS = 15_000;

let byHost = $state<Record<HostKey, ContainerInfo[]>>({});
let lastFetched = $state<Record<HostKey, number>>({});
let loading = $state(false);
let error = $state<string | null>(null);
let selectedHost = $state<HostKey>(LOCAL_HOST);

export const containerStore = {
  get selectedHost() { return selectedHost; },
  get containers() { return byHost[selectedHost] ?? []; },
  get loading() { return loading; },
  get error() { return error; },

  /** Replace the list for the selected host. Called on ContainerList response. */
  set(list: ContainerInfo[]) {
    byHost[selectedHost] = list;
    lastFetched[selectedHost] = Date.now();
    loading = false;
    error = null;
  },

  setLoading() { loading = true; error = null; },
  setError(msg: string) { error = msg; loading = false; },

  /**
   * Switch to a different host. The list for the new host is shown
   * immediately (from cache if present); callers should inspect `isStale()`
   * and re-request if needed.
   */
  setSelectedHost(key: HostKey) {
    selectedHost = key;
    error = null;
  },

  /** True when the cached list for `key` is missing or older than TTL_MS. */
  isStale(key: HostKey = selectedHost): boolean {
    const ts = lastFetched[key];
    return !ts || Date.now() - ts > TTL_MS;
  },

  clear() {
    byHost = {};
    lastFetched = {};
    loading = false;
    error = null;
  },
};
