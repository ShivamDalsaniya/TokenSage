#!/usr/bin/env node
/**
 * TokenSage PostToolUse hook — tracks tokens for Edit/Write/Bash operations.
 * Posts to dashboard API. Always exits 0 (never blocks).
 *
 * Edit savings = tokens(full_file) - tokens(old_string + new_string)
 * i.e. what a full Write would have cost vs what the Edit actually cost.
 */
import { readFileSync } from "fs";
import { countTokens } from "../analytics/token-counter.js";
import { computeProjectPort } from "../config/index.js";

const _rawPort = parseInt(process.env["DASHBOARD_PORT"] ?? "", 10);
const dashPort = isNaN(_rawPort) ? computeProjectPort(process.cwd()) : _rawPort;

let raw = "";
process.stdin.on("data", (c: Buffer) => { raw += c.toString(); });
process.stdin.on("end", async () => {
  try {
    if (process.env["TOKENSAGE_NO_COMPRESS"] === "1") process.exit(0);
    const event = JSON.parse(raw) as { tool_name?: string; tool_input?: Record<string, string> };
    const tool = event.tool_name ?? "";
    const input = event.tool_input ?? {};

    let tokens: { original: number; optimized: number; saved: number; savedPercent: number } | null = null;

    if (tool === "Edit" && input["file_path"] && input["old_string"] && input["new_string"]) {
      // Read current file content (post-edit, so it's the new version)
      let fileContent = "";
      try { fileContent = readFileSync(input["file_path"], "utf-8"); } catch { /* skip */ }

      const editCost = countTokens(input["old_string"] ?? "") + countTokens(input["new_string"] ?? "");
      const writeCost = fileContent ? countTokens(fileContent) : editCost;
      const saved = Math.max(0, writeCost - editCost);
      const savedPercent = writeCost > 0 ? Math.round((saved / writeCost) * 100) : 0;
      tokens = { original: writeCost, optimized: editCost, saved, savedPercent };
    } else if (tool === "Write" && input["content"]) {
      const n = countTokens(input["content"]);
      tokens = { original: n, optimized: n, saved: 0, savedPercent: 0 };
    }

    if (!tokens) process.exit(0);

    const toolLabel = tool.toLowerCase() + "_operation";
    const target = input["file_path"]?.split("/").pop() ?? input["path"]?.split("/").pop();
    await fetch(`http://localhost:${dashPort}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: toolLabel, tokens, target }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  } catch { /* non-fatal */ }
  process.exit(0);
});
