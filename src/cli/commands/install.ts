import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/cli/commands → dist/cli → dist → package root
const PACKAGE_ROOT = path.join(__dirname, "..", "..", "..");
const SERVER_ENTRY = path.join(PACKAGE_ROOT, "dist", "server", "index.js");
const HOOK_SESSION_START = path.join(PACKAGE_ROOT, "dist", "hooks", "session-start.js");
const HOOK_PRE_READ = path.join(PACKAGE_ROOT, "dist", "hooks", "pre-read.js");
const HOOK_PRE_WRITE = path.join(PACKAGE_ROOT, "dist", "hooks", "pre-write.js");
const HOOK_USER_PROMPT = path.join(PACKAGE_ROOT, "dist", "hooks", "user-prompt.js");
const HOOK_POST_TOOL = path.join(PACKAGE_ROOT, "dist", "hooks", "post-tool-edit.js");
const HOOK_POST_BASH = path.join(PACKAGE_ROOT, "dist", "hooks", "post-bash.js");

interface HookEntry { type?: string; command?: string; }
interface HookGroup { matcher?: string; hooks: HookEntry[]; }
interface ClaudeSettings {
  mcpServers?: Record<string, unknown>;
  hooks?: Record<string, HookGroup[]>;
}

function readJson(p: string): Record<string, unknown> {
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>; }
  catch { return {}; }
}

function writeJson(p: string, data: unknown): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function hasHookCmd(arr: HookEntry[], fragment: string): boolean {
  return arr.some(h => h.command?.includes(fragment) === true);
}

export function installClaudeCode(): { changed: boolean; path: string } {
  const settingsPath = path.join(homedir(), ".claude", "settings.json");
  const raw = readJson(settingsPath) as ClaudeSettings;
  let changed = false;

  // MCP server
  if (!raw.mcpServers) raw.mcpServers = {};
  if (!raw.mcpServers["token-sage"]) {
    raw.mcpServers["token-sage"] = { command: "node", args: [SERVER_ENTRY] };
    changed = true;
  }

  // Hooks
  if (!raw.hooks) raw.hooks = {};

  // SessionStart
  if (!raw.hooks["SessionStart"]) raw.hooks["SessionStart"] = [{ hooks: [] }];
  const ss = raw.hooks["SessionStart"][0];
  if (ss && !hasHookCmd(ss.hooks, "session-start")) {
    ss.hooks.push({ type: "command", command: `node ${HOOK_SESSION_START}` });
    changed = true;
  }

  // PreToolUse Read
  if (!raw.hooks["PreToolUse"]) raw.hooks["PreToolUse"] = [];
  let ptRead = raw.hooks["PreToolUse"].find(g => g.matcher === "Read");
  if (!ptRead) { ptRead = { matcher: "Read", hooks: [] }; raw.hooks["PreToolUse"].push(ptRead); }
  if (!hasHookCmd(ptRead.hooks, "pre-read")) {
    ptRead.hooks.push({ type: "command", command: `node ${HOOK_PRE_READ}` });
    changed = true;
  }

  // PreToolUse Write — enforce Edit over full rewrites
  let ptWrite = raw.hooks["PreToolUse"].find(g => g.matcher === "Write");
  if (!ptWrite) { ptWrite = { matcher: "Write", hooks: [] }; raw.hooks["PreToolUse"].push(ptWrite); }
  if (!hasHookCmd(ptWrite.hooks, "pre-write")) {
    ptWrite.hooks.push({ type: "command", command: `node ${HOOK_PRE_WRITE}` });
    changed = true;
  }

  // UserPromptSubmit
  if (!raw.hooks["UserPromptSubmit"]) raw.hooks["UserPromptSubmit"] = [{ hooks: [] }];
  const up = raw.hooks["UserPromptSubmit"][0];
  if (up && !hasHookCmd(up.hooks, "user-prompt")) {
    up.hooks.push({ type: "command", command: `node ${HOOK_USER_PROMPT}` });
    changed = true;
  }

  // PostToolUse Edit/Write — track token savings for structured edits
  if (!raw.hooks["PostToolUse"]) {
    raw.hooks["PostToolUse"] = [
      { matcher: "Edit", hooks: [] },
      { matcher: "Write", hooks: [] },
      { matcher: "Bash", hooks: [] },
    ];
  }
  for (const entry of raw.hooks["PostToolUse"]) {
    const matcher = entry.matcher ?? "";
    if (["Edit", "Write"].includes(matcher) && !hasHookCmd(entry.hooks, "post-tool-edit")) {
      entry.hooks.push({ type: "command", command: `node ${HOOK_POST_TOOL}` });
      changed = true;
    }
    // Bash gets a dedicated compression hook
    if (matcher === "Bash" && !hasHookCmd(entry.hooks, "post-bash")) {
      entry.hooks.push({ type: "command", command: `node ${HOOK_POST_BASH}` });
      changed = true;
    }
  }

  if (changed) writeJson(settingsPath, raw);
  return { changed, path: settingsPath };
}

export function installCursor(): { changed: boolean; path: string } {
  const mcpPath = path.join(homedir(), ".cursor", "mcp.json");
  const raw = readJson(mcpPath) as { mcpServers?: Record<string, unknown> };
  if (!raw.mcpServers) raw.mcpServers = {};
  if (raw.mcpServers["token-sage"]) return { changed: false, path: mcpPath };
  raw.mcpServers["token-sage"] = { command: "node", args: [SERVER_ENTRY] };
  writeJson(mcpPath, raw);
  return { changed: true, path: mcpPath };
}

export function runInstall(): void {
  console.log("TokenSage — Installing MCP registration\n");
  const cc = installClaudeCode();
  console.log(cc.changed ? `✓ Claude Code updated: ${cc.path}` : `✓ Claude Code already configured: ${cc.path}`);
  const cursor = installCursor();
  console.log(cursor.changed ? `✓ Cursor updated: ${cursor.path}` : `✓ Cursor already configured: ${cursor.path}`);
  console.log("\nDone. Restart Claude Code for changes to take effect.");
}
