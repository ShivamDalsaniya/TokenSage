import { existsSync, accessSync, constants, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.join(__dirname, "..", "..", "..");
const DIST_DIR = path.join(PACKAGE_ROOT, "dist");

interface Check {
  name: string;
  ok: boolean;
  message: string;
  fix?: string;
}

async function checkDaemon(): Promise<Check> {
  try {
    const res = await fetch("http://localhost:7099/health", { signal: AbortSignal.timeout(2000) });
    if (res.ok) return { name: "Daemon", ok: true, message: "Running on port 7099" };
    return { name: "Daemon", ok: false, message: "Port 7099 not responding", fix: "Run: tokensage daemon" };
  } catch {
    return { name: "Daemon", ok: false, message: "Not running", fix: "Run: tokensage daemon" };
  }
}

function checkNodeVersion(): Check {
  const parts = process.versions.node.split(".");
  const major = parseInt(parts[0] ?? "0", 10);
  const ok = major >= 22;
  return { name: "Node.js", ok, message: `v${process.versions.node}${ok ? "" : " (need ≥22)"}` };
}

function checkDist(): Check {
  const entry = path.join(DIST_DIR, "server", "index.js");
  const ok = existsSync(entry);
  return { name: "Build output", ok, message: ok ? DIST_DIR : `Missing: ${entry}`, fix: ok ? undefined : "Run: npm run build" };
}

function checkHooks(): Check {
  const hooks = ["session-start", "pre-read", "user-prompt", "post-tool-edit"];
  const missing = hooks.filter(h => !existsSync(path.join(DIST_DIR, "hooks", `${h}.js`)));
  const ok = missing.length === 0;
  return { name: "Hooks", ok, message: ok ? "All compiled" : `Missing: ${missing.join(", ")}`, fix: ok ? undefined : "Run: npm run build" };
}

function checkClaudeCodeMcp(): Check {
  const p = path.join(homedir(), ".claude", "settings.json");
  if (!existsSync(p)) return { name: "Claude Code MCP", ok: false, message: "settings.json not found", fix: "Run: tokensage install" };
  try {
    const s = JSON.parse(readFileSync(p, "utf-8")) as { mcpServers?: Record<string, unknown> };
    const ok = Boolean(s.mcpServers?.["token-sage"]);
    return { name: "Claude Code MCP", ok, message: ok ? "token-sage registered" : "Not registered", fix: ok ? undefined : "Run: tokensage install" };
  } catch {
    return { name: "Claude Code MCP", ok: false, message: "Could not parse settings.json", fix: "Run: tokensage install" };
  }
}

function checkClaudeCodeHooks(): Check {
  const p = path.join(homedir(), ".claude", "settings.json");
  if (!existsSync(p)) return { name: "Claude Code Hooks", ok: false, message: "settings.json not found", fix: "Run: tokensage install" };
  try {
    const s = JSON.parse(readFileSync(p, "utf-8")) as { hooks?: Record<string, unknown> };
    const hasSessionStart = Boolean(s.hooks?.["SessionStart"]);
    const hasPreRead = Boolean(s.hooks?.["PreToolUse"]);
    const ok = hasSessionStart && hasPreRead;
    return { name: "Claude Code Hooks", ok, message: ok ? "SessionStart + PreToolUse registered" : "Some hooks missing", fix: ok ? undefined : "Run: tokensage install" };
  } catch {
    return { name: "Claude Code Hooks", ok: false, message: "Could not parse settings.json", fix: "Run: tokensage install" };
  }
}

function checkDaemonDir(): Check {
  const dir = path.join(homedir(), ".tokensage");
  if (!existsSync(dir)) return { name: "TokenSage dir", ok: true, message: "~/.tokensage not yet created (created on first run)" };
  let writable = false;
  try { accessSync(dir, constants.W_OK); writable = true; } catch { /* not writable */ }
  return { name: "TokenSage dir", ok: writable, message: writable ? "~/.tokensage writable" : "~/.tokensage not writable" };
}

export async function runDoctor(repair = false): Promise<void> {
  console.log("TokenSage Doctor\n");
  const checks: Check[] = [
    checkNodeVersion(),
    checkDist(),
    checkHooks(),
    checkDaemonDir(),
    checkClaudeCodeMcp(),
    checkClaudeCodeHooks(),
    await checkDaemon(),
  ];
  let allOk = true;
  for (const c of checks) {
    const icon = c.ok ? "✓" : "✗";
    console.log(`  ${icon} ${c.name}: ${c.message}`);
    if (!c.ok) { allOk = false; if (c.fix) console.log(`    → ${c.fix}`); }
  }
  if (!repair) {
    console.log(allOk ? "\nAll checks passed." : "\nRun with --repair to auto-fix issues.");
    return;
  }
  if (!allOk) {
    console.log("\nAttempting auto-repair...");
    const { runInstall } = await import("./install.js");
    runInstall();
  }
}
