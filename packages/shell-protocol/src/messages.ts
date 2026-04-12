import { z } from 'zod';

export const SessionInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  shell: z.string(),
  cwd: z.string(),
  started_at: z.string(),
  // New optional fields for enhanced session tracking
  state: z.enum(['running', 'exited', 'closed', 'error']).optional(),
  foreground_process: z.string().optional(),       // e.g., "claude", "vim", "zsh"
  last_activity_at: z.string().optional(),         // ISO timestamp
  exit_code: z.number().optional(),                // set when state="exited"
  // Docker container fields
  container_id: z.string().optional(),
  container_name: z.string().optional(),
  container_image: z.string().optional(),
  // SSH connection fields
  ssh_connection_id: z.string().optional(),
  ssh_host: z.string().optional(),
  ssh_user: z.string().optional(),
});

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

// Base schema for messages that include a session_id
const WithSessionId = z.object({ session_id: z.string() });

export const ClientMessageSchema = z.union([
  z.object({ type: z.literal('auth'), token: z.string(), protocol_version: z.string().optional() }),
  z.object({ type: z.literal('list_sessions') }),
  z.object({
    type: z.literal('create_session'),
    cwd: z.string(),
    shell: z.string(),
    env: z.record(z.string(), z.string()),
    cols: z.number(),
    rows: z.number(),
    container_id: z.string().optional(),
    ssh_connection_id: z.string().optional(),
  }),
  WithSessionId.extend({ type: z.literal('attach'), mode: z.enum(['mirror', 'exclusive']) }),
  WithSessionId.extend({ type: z.literal('input'), data: z.string() }),
  WithSessionId.extend({ type: z.literal('resize'), cols: z.number(), rows: z.number() }),
  WithSessionId.extend({ type: z.literal('rename_session'), new_name: z.string() }),
  WithSessionId.extend({ type: z.literal('kill_session') }),
  // Reply to a server-side `EditRequest`. `id` echoes the correlation
  // token from the request. `cancelled=true` signals the user dismissed
  // the modal; `contents` is ignored in that case. The server frames
  // this and writes it to the session PTY for the wrapper script to read.
  WithSessionId.extend({
    type: z.literal('edit_reply'),
    id: z.string(),
    contents: z.string(),
    cancelled: z.boolean(),
  }),
  z.object({ type: z.literal('auth_password'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('auth_pubkey_init'), username: z.string(), pubkey: z.string() }),
  z.object({ type: z.literal('auth_pubkey_verify'), signature: z.string(), algorithm: z.string() }),
  z.object({ type: z.literal('auth_token'), token: z.string() }),
  z.object({ type: z.literal('refresh_token'), refresh_token: z.string() }),
  z.object({ type: z.literal('list_containers'), ssh_connection_id: z.string().optional() }),
  z.object({ type: z.literal('list_ssh_connections') }),
  z.object({
    type: z.literal('add_ssh_connection'),
    name: z.string(),
    host: z.string(),
    user: z.string(),
    port: z.number(),
  }),
  z.object({
    type: z.literal('update_ssh_connection'),
    id: z.string(),
    name: z.string(),
    host: z.string(),
    user: z.string(),
    port: z.number(),
  }),
  z.object({ type: z.literal('remove_ssh_connection'), id: z.string() }),
  z.object({ type: z.literal('import_ssh_config') }),
  z.object({ type: z.literal('save_workspace'), workspace: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('load_workspace') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.union([
  z.object({ type: z.literal('AuthOk'), token: z.string(), expires: z.string(), protocol_version: z.string().optional(), refresh_token: z.string().optional() }),
  z.object({ type: z.literal('AuthChallenge'), nonce: z.string() }),
  z.object({ type: z.literal('SessionList'), sessions: z.array(SessionInfoSchema) }),
  WithSessionId.extend({ type: z.literal('Output'), data: z.string() }),
  WithSessionId.extend({ type: z.literal('SessionClosed') }),
  z.object({ type: z.literal('Error'), message: z.string(), error_code: z.string().optional() }),
  z.object({ type: z.literal('PairResponse'), code: z.string(), expiry_secs: z.number() }),
  z.object({ type: z.literal('Shutdown'), reason: z.string() }),
  WithSessionId.extend({ type: z.literal('ForegroundChanged'), process_name: z.string().nullable() }),
  WithSessionId.extend({ type: z.literal('SessionActivity'), activity_type: z.enum(['activity', 'bell', 'silence']) }),
  WithSessionId.extend({ type: z.literal('SessionExited'), exit_code: z.number().nullable() }),
  WithSessionId.extend({ type: z.literal('CwdChanged'), cwd: z.string() }),
  // Tool-action events: a program in the remote session emitted an OSC
  // sequence asking the local client to perform a native action on the
  // user's computer. `data` and `url` are already decoded on the server
  // (the OSC wire encoding uses base64; we don't re-encode for JSON).
  WithSessionId.extend({ type: z.literal('ClipboardWrite'), data: z.string() }),
  WithSessionId.extend({ type: z.literal('OpenUrl'), url: z.string() }),
  // A program in the remote session emitted an OSC 7777 `edit_request`,
  // asking the user to edit a file locally and send the result back.
  // `id` is an opaque correlation token the wrapper script chose; the
  // client must echo it back in the matching `edit_reply`. `filename`
  // is the original path on the remote (display only — the local edit
  // round-trips through the PTY, not the filesystem). `contents` is the
  // current file contents the modal should pre-fill.
  WithSessionId.extend({
    type: z.literal('EditRequest'),
    id: z.string(),
    filename: z.string(),
    contents: z.string(),
  }),
  z.object({ type: z.literal('WorkspaceData'), workspace: z.record(z.string(), z.unknown()).nullable() }),
  z.object({
    type: z.literal('ContainerList'),
    containers: z.array(z.object({
      id: z.string(),
      name: z.string(),
      image: z.string(),
      status: z.string(),
      state: z.string(),
    })),
  }),
  z.object({
    type: z.literal('SshConnectionList'),
    connections: z.array(z.object({
      id: z.string(),
      name: z.string(),
      host: z.string(),
      user: z.string(),
      port: z.number(),
    })),
  }),
  z.object({
    type: z.literal('SshConfigImportResult'),
    hosts: z.array(z.object({
      name: z.string(),
      hostname: z.string().optional(),
      user: z.string().optional(),
      port: z.number().optional(),
    })),
  }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
}

export interface SshConnectionInfo {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
}

export interface SshConfigHost {
  name: string;
  hostname?: string;
  user?: string;
  port?: number;
}
