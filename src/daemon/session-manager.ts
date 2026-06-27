export interface ActiveSession {
  id: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  startedAt: string;
  lastActivityAt: string;
  pid?: number;
  savedTokens: number;
}

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();

  attach(s: Omit<ActiveSession, "startedAt" | "lastActivityAt" | "savedTokens">): ActiveSession {
    const existing = this.sessions.get(s.id);
    const rec: ActiveSession = {
      ...s,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      savedTokens: existing?.savedTokens ?? 0,
    };
    this.sessions.set(s.id, rec);
    return rec;
  }

  touch(id: string, saved = 0): void {
    const s = this.sessions.get(id);
    if (s) { s.lastActivityAt = new Date().toISOString(); s.savedTokens += saved; }
  }

  detach(id: string): void { this.sessions.delete(id); }

  getAll(): ActiveSession[] { return [...this.sessions.values()]; }

  getByProject(projectId: string): ActiveSession[] {
    return [...this.sessions.values()].filter(s => s.projectId === projectId);
  }

  prune(): number {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (new Date(s.lastActivityAt).getTime() < cutoff) { this.sessions.delete(id); n++; }
    }
    return n;
  }
}
