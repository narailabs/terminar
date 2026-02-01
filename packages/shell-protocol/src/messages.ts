import { z } from 'zod';

export const SessionInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  shell: z.string(),
  started_at: z.string(),
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
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
