#!/usr/bin/env node
/**
 * TokenSage Daemon — persistent background process on port 7099.
 * Manages project registry, session tracking, and dashboard coordination.
 */
import Fastify from "fastify";
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import { execSync, spawn } from "child_process";
import { ProjectRegistry, TOKENSAGE_DIR } from "./project-registry.js";
import { SessionManager } from "./session-manager.js";
import { computeProjectPort } from "../config/index.js";

const DAEMON_PORT = 7099;
const PID_FILE = path.join(TOKENSAGE_DIR, "daemon.pid");

function ensureDir(): void {
  if (!existsSync(TOKENSAGE_DIR)) mkdirSync(TOKENSAGE_DIR, { recursive: true });
}

const registry = new ProjectRegistry();
const sessions = new SessionManager();
// projectPath → actual dashboard port (populated by MCP server at startup)
const dashboardPorts = new Map<string, number>();
const fastify = Fastify({ logger: false });

// Prune stale sessions every 5 min
setInterval(() => { sessions.prune(); }, 5 * 60 * 1000).unref();

fastify.get("/health", async () => ({
  status: "ok", service: "tokensage-daemon", version: "1.0.0", pid: process.pid,
}));

fastify.get("/status", async () => ({
  daemon: { status: "running", pid: process.pid, port: DAEMON_PORT, uptime: process.uptime() },
  projects: registry.getAll(),
  sessions: sessions.getAll(),
}));

fastify.post("/projects/register", async (req) => {
  const body = req.body as { path?: string; name?: string; language?: string };
  if (!body.path) return { error: "path required" };
  const id = createHash("sha256").update(body.path).digest("hex").slice(0, 8);
  const port = computeProjectPort(body.path);
  const rec = registry.register({
    id,
    path: body.path,
    name: body.name ?? path.basename(body.path),
    port,
    language: body.language ?? "unknown",
  });
  return { ok: true, project: rec };
});

fastify.get("/projects", async () => ({ projects: registry.getAll() }));

fastify.post("/sessions/attach", async (req) => {
  const body = req.body as {
    sessionId?: string; projectId?: string; projectPath?: string; projectName?: string; pid?: number;
  };
  if (!body.sessionId || !body.projectId || !body.projectPath || !body.projectName) {
    return { error: "sessionId, projectId, projectPath, projectName required" };
  }
  const s = sessions.attach({
    id: body.sessionId,
    projectId: body.projectId,
    projectPath: body.projectPath,
    projectName: body.projectName,
    pid: body.pid,
  });
  return { ok: true, session: s };
});

fastify.post("/sessions/touch", async (req) => {
  const body = req.body as { sessionId?: string; savedTokens?: number };
  if (body.sessionId) sessions.touch(body.sessionId, body.savedTokens ?? 0);
  return { ok: true };
});

fastify.post("/sessions/detach", async (req) => {
  const body = req.body as { sessionId?: string };
  if (body.sessionId) sessions.detach(body.sessionId);
  return { ok: true };
});

// Dashboard calls this — it knows projectPath but not sessionId
fastify.post("/sessions/track-savings", async (req) => {
  const body = req.body as { projectPath?: string; savedTokens?: number };
  if (!body.projectPath || !body.savedTokens || body.savedTokens <= 0) return { ok: true };
  const saved = body.savedTokens;
  const projectId = createHash("sha256").update(body.projectPath).digest("hex").slice(0, 8);
  // Update most recent session for this project
  const projectSessions = sessions.getByProject(projectId);
  if (projectSessions.length > 0) {
    const latest = projectSessions.sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    )[0];
    if (latest) sessions.touch(latest.id, saved);
  }
  // Update project-level cumulative savings
  registry.updateSavings(projectId, saved);
  return { ok: true };
});

fastify.get("/sessions", async () => ({ sessions: sessions.getAll() }));

// MCP server calls this after its dashboard starts — stores actual port
fastify.post("/dashboard/register", async (req) => {
  const body = req.body as { projectPath?: string; port?: number };
  if (!body.projectPath || !body.port) return { error: "projectPath and port required" };
  dashboardPorts.set(body.projectPath, body.port);
  return { ok: true, projectPath: body.projectPath, port: body.port };
});

// Hook calls this to get the exact dashboard URL for a project
fastify.get("/dashboard/port", async (req) => {
  const projectPath = (req.query as Record<string, string>)["projectPath"];
  if (!projectPath) return { port: null, error: "projectPath query param required" };
  const port = dashboardPorts.get(projectPath) ?? null;
  return { port };
});

fastify.post("/dashboard/open", async (req) => {
  const body = req.body as { url?: string };
  if (!body.url) return { ok: false, error: "url required" };

  // Validate: only allow http/https to localhost
  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "only http/https allowed" };
  }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return { ok: false, error: "only localhost urls allowed" };
  }

  try {
    // Pass URL as a separate argument — no shell interpolation
    if (process.platform === "darwin") spawn("open", [parsed.href], { stdio: "ignore", detached: true }).unref();
    else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", parsed.href], { stdio: "ignore", shell: false, detached: true }).unref();
    else spawn("xdg-open", [parsed.href], { stdio: "ignore", detached: true }).unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
});

fastify.post("/shutdown", async (_req, reply) => {
  await reply.send({ ok: true, message: "daemon shutting down" });
  setTimeout(() => {
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    process.exit(0);
  }, 100);
});

async function main(): Promise<void> {
  ensureDir();
  try {
    await fastify.listen({ port: DAEMON_PORT, host: "localhost" });
    writeFileSync(PID_FILE, String(process.pid), "utf-8");
    console.error(`[TokenSage Daemon] Running on port ${DAEMON_PORT} (pid ${process.pid})`);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "EADDRINUSE") {
      console.error(`[TokenSage Daemon] Already running on port ${DAEMON_PORT}`);
      process.exit(0);
    }
    throw err;
  }
}

main().catch(err => { console.error("[TokenSage Daemon] Fatal:", err); process.exit(1); });
