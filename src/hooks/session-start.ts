#!/usr/bin/env node
/**
 * TokenSage SessionStart hook — Serena-style lifecycle management.
 * 1. Ensure daemon running (start if not)
 * 2. Register project + attach session
 * 3. Wait for dashboard ready
 * 4. Open browser
 */
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { computeProjectPort } from "../config/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/hooks → dist → package root
const DAEMON_ENTRY = path.join(__dirname, "..", "daemon", "index.js");
const DASHBOARD_ENTRY = path.join(__dirname, "..", "server", "dashboard.js");
const DAEMON_PORT = 7099;

const projectPath = process.env["PROJECT_PATH"] ?? process.cwd();
const projectName = process.env["PROJECT_NAME"] ?? path.basename(projectPath);
const port = parseInt(process.env["DASHBOARD_PORT"] ?? String(computeProjectPort(projectPath)), 10);
const dashUrl = `http://localhost:${port}`;

async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${DAEMON_PORT}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch { return false; }
}

async function isDashboardRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${dashUrl}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch { return false; }
}

async function ensureDashboard(): Promise<void> {
  if (await isDashboardRunning()) return;
  if (!existsSync(DASHBOARD_ENTRY)) return;
  // Hook has correct project cwd — pass it explicitly so dashboard computes right port
  const child = spawn(process.execPath, [DASHBOARD_ENTRY], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PROJECT_PATH: projectPath,
      PROJECT_NAME: projectName,
      DASHBOARD_PORT: String(port),
      DASHBOARD_AUTO_OPEN: "false", // hook handles browser open
    },
  });
  child.unref();
}

async function ensureDaemon(): Promise<void> {
  if (await isDaemonRunning()) return;
  if (!existsSync(DAEMON_ENTRY)) return;
  const child = spawn(process.execPath, [DAEMON_ENTRY], { detached: true, stdio: "ignore" });
  child.unref();
  const start = Date.now();
  while (Date.now() - start < 5000) {
    await new Promise(r => setTimeout(r, 300));
    if (await isDaemonRunning()) return;
  }
}

async function registerProject(): Promise<void> {
  try {
    let language = "unknown";
    if (existsSync(path.join(projectPath, "package.json"))) language = "typescript";
    else if (existsSync(path.join(projectPath, "go.mod"))) language = "go";
    else if (existsSync(path.join(projectPath, "Cargo.toml"))) language = "rust";
    else if (existsSync(path.join(projectPath, "requirements.txt")) || existsSync(path.join(projectPath, "pyproject.toml"))) language = "python";

    await fetch(`http://localhost:${DAEMON_PORT}/projects/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, name: projectName, language }),
      signal: AbortSignal.timeout(2000),
    });

    // Session attachment handled by dashboard process (stable hash-based ID)
  } catch { /* non-fatal */ }
}

async function getDashboardPort(): Promise<number> {
  // Ask daemon for the actual port the MCP server registered
  try {
    const res = await fetch(
      `http://localhost:${DAEMON_PORT}/dashboard/port?projectPath=${encodeURIComponent(projectPath)}`,
      { signal: AbortSignal.timeout(1000) },
    );
    if (res.ok) {
      const { port: daemonPort } = await res.json() as { port: number | null };
      if (daemonPort) return daemonPort;
    }
  } catch { /* daemon not reachable, fall back */ }
  return port; // fallback: computed from cwd
}

async function waitForDashboard(maxMs = 10000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    // Re-query daemon each iteration — MCP server may register mid-wait
    const resolvedPort = await getDashboardPort();
    const url = `http://localhost:${resolvedPort}`;
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return url;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", shell: false, detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch { /* non-fatal */ }
}

async function main(): Promise<void> {
  if (process.env["TOKENSAGE_NO_COMPRESS"] === "1") process.exit(0);
  if (process.env["DASHBOARD_AUTO_OPEN"] === "false") process.exit(0);

  await ensureDaemon();
  await ensureDashboard(); // hook owns dashboard startup (MCP server runs with wrong cwd)
  await registerProject();

  const resolvedUrl = await waitForDashboard();
  if (resolvedUrl) {
    openBrowser(resolvedUrl);
    console.error(`[TokenSage] Dashboard: ${resolvedUrl} (${projectName})`);
  } else {
    console.error(`[TokenSage] Dashboard not ready at ${dashUrl} — is MCP server running?`);
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
