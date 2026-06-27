#!/usr/bin/env node
/**
 * TokenSage PreToolUse hook — intercepts large file reads and returns
 * compressed structural skeletons to save context-window tokens.
 *
 * Rules:
 *  - Only fires on the Read tool
 *  - Only code files (known extensions)
 *  - Only full-file reads (no offset/limit = exploration mode)
 *  - Only when file exceeds COMPRESS_THRESHOLD_LINES
 *  - Only when savings exceed MIN_SAVINGS_PCT
 *  - Skipped when TOKENSAGE_NO_COMPRESS=1 env var is set
 *
 * Exit 0  → let Read proceed normally
 * Outputs { decision: "block", reason: "<compressed>" } → Claude sees
 *         compressed skeleton instead of full file content
 */

import { readFileSync } from "fs";
import { extname } from "path";
import { compressContent } from "../compression/code-compressor.js";
import { computeProjectPort } from "../config/index.js";

const _rawPort = parseInt(process.env["DASHBOARD_PORT"] ?? "", 10);
const dashPort = isNaN(_rawPort) ? computeProjectPort(process.cwd()) : _rawPort;

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cpp", ".c", ".h",
  ".cs", ".rb", ".php", ".swift", ".kt", ".scala",
  ".vue", ".svelte",
]);

const COMPRESS_THRESHOLD_LINES = parseInt(process.env["TOKENSAGE_COMPRESS_THRESHOLD"] ?? "100", 10);
const MIN_SAVINGS_PCT = parseInt(process.env["TOKENSAGE_MIN_SAVINGS_PCT"] ?? "15", 10);

function block(reason: string): void {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

let raw = "";
process.stdin.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
process.stdin.on("end", async () => {
  // Skip if user opted out
  if (process.env["TOKENSAGE_NO_COMPRESS"] === "1") process.exit(0);

  try {
    const call = JSON.parse(raw) as { tool_name?: string; tool_input?: Record<string, unknown> };

    if (call.tool_name !== "Read") process.exit(0);

    const filePath = call.tool_input?.["file_path"];
    if (typeof filePath !== "string") process.exit(0);

    // Targeted reads (offset/limit) pass through — needed for precise editing
    if (call.tool_input?.["offset"] != null || call.tool_input?.["limit"] != null) process.exit(0);

    const ext = extname(filePath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) process.exit(0);

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      process.exit(0); // File unreadable — let Read handle the error
    }

    const lineCount = content.split("\n").length;
    if (lineCount < COMPRESS_THRESHOLD_LINES) process.exit(0);

    const result = compressContent(content, filePath);

    if (result.tokens.savedPercent < MIN_SAVINGS_PCT) process.exit(0);

    // Track compression savings — awaited so process doesn't exit before fetch completes
    await fetch(`http://localhost:${dashPort}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "auto_compress_read", tokens: result.tokens }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {}); // non-fatal

    // Build compressed output
    const lines: string[] = [
      `╔═ TokenSage Auto-Compressed ══════════════════════════════════╗`,
      `  ${filePath}`,
      `  ${lineCount} lines → ${result.tokens.original} tokens saved ${result.tokens.savedPercent}% (${result.tokens.optimized} tokens shown)`,
      `  To read full file: use Read with offset/limit, or set TOKENSAGE_NO_COMPRESS=1`,
      `╚══════════════════════════════════════════════════════════════╝`,
      "",
      `Language: ${result.language}`,
      `Purpose: ${result.purpose}`,
      "",
      `Summary: ${result.summary}`,
      "",
    ];

    if (result.imports.length > 0) {
      lines.push("── Imports ──");
      for (const imp of result.imports.slice(0, 20)) {
        const specs = imp.specifiers.length > 0
          ? ` { ${imp.specifiers.slice(0, 6).join(", ")}${imp.specifiers.length > 6 ? "…" : ""} }`
          : "";
        lines.push(`  ${imp.source}${specs}`);
      }
      if (result.imports.length > 20) lines.push(`  … +${result.imports.length - 20} more`);
      lines.push("");
    }

    if (result.exports.length > 0) {
      lines.push(`── Exports ──`);
      lines.push(`  ${result.exports.join(", ")}`);
      lines.push("");
    }

    if (result.symbols.length > 0) {
      lines.push("── Symbols ──");
      for (const sym of result.symbols) {
        const vis = sym.exported ? "export " : "";
        const asyncMark = sym.async ? "async " : "";
        const sig = sym.signature ? `: ${sym.signature}` : "";
        lines.push(`  ${vis}${asyncMark}${sym.kind} ${sym.name}${sig}`);
      }
      lines.push("");
    }

    if (result.dependencies.length > 0) {
      lines.push(`── External Deps ──`);
      lines.push(`  ${result.dependencies.join(", ")}`);
      lines.push("");
    }

    block(lines.join("\n"));

  } catch {
    process.exit(0); // Any parse/runtime error — let Read proceed normally
  }
});
