import type { ContainerInfo } from './shared-protocol';

let containers = $state<ContainerInfo[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

export const containerStore = {
  get containers() { return containers; },
  get loading() { return loading; },
  get error() { return error; },
  set(list: ContainerInfo[]) { containers = list; loading = false; error = null; },
  setLoading() { loading = true; },
  setError(msg: string) { error = msg; loading = false; },
  clear() { containers = []; loading = false; error = null; },
};
