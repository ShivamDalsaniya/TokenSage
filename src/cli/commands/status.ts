interface ProjectInfo {
  id: string; name: string; path: string; port: number;
  sessionCount: number; totalSavedTokens: number; lastSeenAt: string;
}
interface SessionInfo {
  id: string; projectName: string; startedAt: string; savedTokens: number;
}
interface DaemonStatus {
  daemon: { status: string; pid: number; port: number; uptime: number };
  projects: ProjectInfo[];
  sessions: SessionInfo[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function ago(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export async function runStatus(): Promise<void> {
  console.log("TokenSage Status\n");
  let data: DaemonStatus | null = null;
  try {
    const res = await fetch("http://localhost:7099/status", { signal: AbortSignal.timeout(2000) });
    data = await res.json() as DaemonStatus;
  } catch {
    console.log("  Daemon:   not running  (run: tokensage daemon)");
    return;
  }
  console.log(`  Daemon:   running  pid=${data.daemon.pid}  port=${data.daemon.port}  up=${Math.floor(data.daemon.uptime)}s`);
  console.log(`  Projects: ${data.projects.length}`);
  console.log(`  Sessions: ${data.sessions.length}`);
  if (data.projects.length > 0) {
    console.log("\n  Projects:");
    for (const p of data.projects) {
      const dashUrl = `http://localhost:${p.port}`;
      console.log(`    [${p.id}] ${p.name}  sessions=${p.sessionCount}  saved=${fmt(p.totalSavedTokens)}  dashboard=${dashUrl}  (${ago(p.lastSeenAt)})`);
    }
  }
  if (data.sessions.length > 0) {
    console.log("\n  Active sessions:");
    for (const s of data.sessions) {
      console.log(`    ${s.id.slice(0, 8)}  ${s.projectName}  saved=${fmt(s.savedTokens)}  (${ago(s.startedAt)})`);
    }
  }
  const totalSaved = data.projects.reduce((acc, p) => acc + p.totalSavedTokens, 0);
  if (totalSaved > 0) console.log(`\n  Total tokens saved (all-time): ${fmt(totalSaved)}`);
}
