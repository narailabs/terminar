import type { SshConnectionInfo, SshConfigHost } from './shared-protocol';

let connections = $state<SshConnectionInfo[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let importHosts = $state<SshConfigHost[]>([]);

export const sshConnectionStore = {
  get connections() { return connections; },
  get loading() { return loading; },
  get error() { return error; },
  get importHosts() { return importHosts; },
  set(list: SshConnectionInfo[]) { connections = list; loading = false; error = null; },
  setLoading() { loading = true; },
  setError(msg: string) { error = msg; loading = false; },
  setImportHosts(hosts: SshConfigHost[]) { importHosts = hosts; },
  clearImportHosts() { importHosts = []; },
  clear() { connections = []; loading = false; error = null; },
};
