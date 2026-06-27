#!/usr/bin/env node
/**
 * TokenSage CLI
 * Commands: daemon, install, doctor, status, dashboard, stop, help
 */
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/cli → dist → package root
const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const DAEMON_ENTRY = path.join(PACKAGE_ROOT, "dist", "daemon", "index.js");
const DAEMON_PORT = 7099;

async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${DAEMON_PORT}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch { return false; }
}

async function startDaemonBg(): Promise<void> {
  if (!existsSync(DAEMON_ENTRY)) {
    console.error(`Daemon not found: ${DAEMON_ENTRY}\nRun: npm run build`);
    process.exit(1);
  }
  const child = spawn(process.execPath, [DAEMON_ENTRY], { detached: true, stdio: "ignore" });
  child.unref();
  const start = Date.now();
  while (Date.now() - start < 8000) {
    await new Promise(r => setTimeout(r, 300));
    if (await isDaemonRunning()) return;
  }
  console.error("Daemon did not start within 8s");
}

async function openProjectDashboard(): Promise<void> {
  const { computeProjectPort } = await import("../config/index.js");
  const port = computeProjectPort(process.cwd());
  const url = `http://localhost:${port}`;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
      else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", shell: false, detached: true }).unref();
      else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
      console.log(`Opened: ${url}`);
    } else {
      console.log(`Dashboard not running. Start MCP server first.\nExpected: ${url}`);
    }
  } catch {
    console.log(`Dashboard not running. Start MCP server first.\nExpected: ${url}`);
  }
}

async function stopDaemon(): Promise<void> {
  try {
    await fetch(`http://localhost:${DAEMON_PORT}/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) });
    console.log("Daemon stopped.");
  } catch {
    console.log("Daemon not running.");
  }
}

function printHelp(): void {
  console.log(`
TokenSage — Token reduction for Claude Code and agentic AI

Usage: tokensage [command]

Commands:
  (default)    Show status
  daemon       Start persistent daemon (background)
  install      Register MCP in Claude Code, Cursor
  doctor       Validate setup, auto-repair issues
  status       Show daemon, projects, sessions
  dashboard    Open dashboard for current project
  stop         Stop daemon
  help         Show this help

Examples:
  tokensage install         # one-time setup
  tokensage daemon          # start background daemon
  tokensage status          # check everything
  tokensage doctor --repair # fix issues automatically
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case "daemon": {
      if (await isDaemonRunning()) {
        console.log("Daemon already running. Use: tokensage status");
      } else {
        console.log("Starting daemon...");
        await startDaemonBg();
        console.log(`Daemon started on port ${DAEMON_PORT}`);
      }
      break;
    }
    case "install": {
      const { runInstall } = await import("./commands/install.js");
      runInstall();
      break;
    }
    case "doctor": {
      const { runDoctor } = await import("./commands/doctor.js");
      await runDoctor(args.includes("--repair"));
      break;
    }
    case "status":
    case undefined: {
      const { runStatus } = await import("./commands/status.js");
      await runStatus();
      break;
    }
    case "dashboard": {
      await openProjectDashboard();
      break;
    }
    case "stop": {
      await stopDaemon();
      break;
    }
    case "help":
    case "--help":
    case "-h": {
      printHelp();
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}\nRun: tokensage help`);
      process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
