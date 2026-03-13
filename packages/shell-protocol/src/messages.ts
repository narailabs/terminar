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
});

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

// Base schema for messages that include a session_id
const WithSessionId = z.object({ session_id: z.string() });

export const ClientMessageSchema = z.union([
  z.object({ type: z.literal('list_sessions') }),
  z.object({
    type: z.literal('create_session'),
    cwd: z.string(),
    shell: z.string(),
    env: z.record(z.string(), z.string()),
    cols: z.number(),
    rows: z.number(),
  }),
  WithSessionId.extend({ type: z.literal('attach'), mode: z.enum(['mirror', 'exclusive']) }),
  WithSessionId.extend({ type: z.literal('input'), data: z.string() }),
  WithSessionId.extend({ type: z.literal('resize'), cols: z.number(), rows: z.number() }),
  WithSessionId.extend({ type: z.literal('rename_session'), new_name: z.string() }),
  WithSessionId.extend({ type: z.literal('kill_session') }),
  z.object({ type: z.literal('save_workspace'), workspace: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('load_workspace') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.union([
  z.object({ type: z.literal('SessionList'), sessions: z.array(SessionInfoSchema) }),
  WithSessionId.extend({ type: z.literal('Output'), data: z.string() }),
  WithSessionId.extend({ type: z.literal('SessionClosed') }),
  z.object({ type: z.literal('Error'), message: z.string(), error_code: z.string().optional() }),
  z.object({ type: z.literal('Shutdown'), reason: z.string() }),
  WithSessionId.extend({ type: z.literal('ForegroundChanged'), process_name: z.string().nullable() }),
  WithSessionId.extend({ type: z.literal('SessionActivity'), activity_type: z.enum(['activity', 'bell', 'silence']) }),
  WithSessionId.extend({ type: z.literal('SessionExited'), exit_code: z.number().nullable() }),
  WithSessionId.extend({ type: z.literal('CwdChanged'), cwd: z.string() }),
  z.object({ type: z.literal('WorkspaceData'), workspace: z.record(z.string(), z.unknown()).nullable() }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
