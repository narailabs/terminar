import { z } from 'zod';

export const SessionInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  shell: z.string(),
  cwd: z.string(),
  started_at: z.string(),
  // New optional fields for enhanced session tracking
  state: z.string().optional(),                    // "running", "exited", "closed", "error"
  foreground_process: z.string().optional(),       // e.g., "claude", "vim", "zsh"
  last_activity_at: z.string().optional(),         // ISO timestamp
  exit_code: z.number().optional(),                // set when state="exited"
});

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('list_sessions') }),
  z.object({
    type: z.literal('create_session'),
    cwd: z.string(),
    shell: z.string(),
    env: z.record(z.string(), z.string()),
    cols: z.number(),
    rows: z.number(),
  }),
  z.object({ type: z.literal('attach'), session_id: z.string(), mode: z.string() }),
  z.object({ type: z.literal('input'), session_id: z.string(), data: z.string() }),
  z.object({ type: z.literal('resize'), session_id: z.string(), cols: z.number(), rows: z.number() }),
  z.object({ type: z.literal('rename_session'), session_id: z.string(), new_name: z.string() }),
  z.object({ type: z.literal('kill_session'), session_id: z.string() }),
  z.object({ type: z.literal('auth_password'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('auth_pubkey_init'), username: z.string(), pubkey: z.string() }),
  z.object({ type: z.literal('auth_pubkey_verify'), signature: z.string(), algorithm: z.string() }),
  z.object({ type: z.literal('auth_token'), token: z.string() }),
  // New workspace management messages
  z.object({ type: z.literal('save_workspace'), workspace: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('load_workspace') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AuthOk'), token: z.string(), expires: z.string() }),
  z.object({ type: z.literal('AuthChallenge'), nonce: z.string() }),
  z.object({ type: z.literal('SessionList'), sessions: z.array(SessionInfoSchema) }),
  z.object({ type: z.literal('Output'), session_id: z.string(), data: z.string() }),
  z.object({ type: z.literal('SessionClosed'), session_id: z.string() }),
  z.object({ type: z.literal('Error'), message: z.string() }),
  z.object({ type: z.literal('PairResponse'), code: z.string(), expiry_secs: z.number() }),
  z.object({ type: z.literal('Shutdown'), reason: z.string() }),
  // New session tracking messages
  z.object({ type: z.literal('ForegroundChanged'), session_id: z.string(), process_name: z.string().nullable() }),
  z.object({ type: z.literal('SessionActivity'), session_id: z.string(), activity_type: z.enum(['activity', 'bell', 'silence']) }),
  z.object({ type: z.literal('SessionExited'), session_id: z.string(), exit_code: z.number().nullable() }),
  z.object({ type: z.literal('WorkspaceData'), workspace: z.record(z.string(), z.unknown()).nullable() }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
