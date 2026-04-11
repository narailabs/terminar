const cwdMap = new Map<string, string>();

export const sessionCwdStore = {
  set(sessionId: string, cwd: string) {
    cwdMap.set(sessionId, cwd);
  },
  get(sessionId: string): string | undefined {
    return cwdMap.get(sessionId);
  },
  clear() {
    cwdMap.clear();
  },
  deleteStaleSessions(currentSessionIds: Set<string>) {
    for (const id of cwdMap.keys()) {
      if (!currentSessionIds.has(id)) cwdMap.delete(id);
    }
  },
};
