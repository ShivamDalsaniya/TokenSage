#!/usr/bin/env node
/**
 * TokenSage PostToolUse hook — compresses large Bash output before Claude sees it.
 *
 * Uses `hookSpecificOutput.updatedToolOutput` to replace raw output with a
 * head/tail summary when output exceeds BASH_COMPRESS_THRESHOLD tokens.
 *
 * Exit 0  → pass through (output too small to bother)
 * Outputs { hookSpecificOutput: { updatedToolOutput: "<compressed>" } } → Claude
 *         sees compressed summary instead of full bash output
 */
import { countTokens, calculateSavings } from "../analytics/token-counter.js";
import { computeProjectPort } from "../config/index.js";

const _rawPort = parseInt(process.env["DASHBOARD_PORT"] ?? "", 10);
const dashPort = isNaN(_rawPort) ? computeProjectPort(process.cwd()) : _rawPort;

const BASH_COMPRESS_THRESHOLD = parseInt(process.env["TOKENSAGE_BASH_THRESHOLD"] ?? "200", 10);
const HEAD_LINES = parseInt(process.env["TOKENSAGE_BASH_HEAD_LINES"] ?? "40", 10);
const TAIL_LINES = parseInt(process.env["TOKENSAGE_BASH_TAIL_LINES"] ?? "15", 10);
const MIN_SAVINGS_PCT = parseInt(process.env["TOKENSAGE_MIN_SAVINGS_PCT"] ?? "15", 10);

/** Extract text content from Bash tool_response (handles string or object). */
function extractOutput(toolResponse: unknown): string {
  if (typeof toolResponse === "string") return toolResponse;
  if (toolResponse && typeof toolResponse === "object") {
    const r = toolResponse as Record<string, unknown>;
    // Claude Code wraps bash output as { output: string } or { content: [{type:"text", text:string}] }
    if (typeof r["output"] === "string") return r["output"];
    if (Array.isArray(r["content"])) {
      return (r["content"] as Array<{ type?: string; text?: string }>)
        .filter(c => c.type === "text")
        .map(c => c.text ?? "")
        .join("");
    }
  }
  return "";
}

/** Compress large bash output to head + tail with omission marker. */
function compressBashOutput(output: string): string {
  const lines = output.split("\n");
  const total = lines.length;

  if (total <= HEAD_LINES + TAIL_LINES + 5) return output; // not worth truncating

  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(-TAIL_LINES);
  const omitted = total - HEAD_LINES - TAIL_LINES;
  const omittedTokens = countTokens(lines.slice(HEAD_LINES, -TAIL_LINES).join("\n"));

  const marker = [
    ``,
    `╔═ TokenSage Bash Output Compressed ════════════════════════════╗`,
    `  ${omitted} lines / ~${omittedTokens} tokens omitted from middle`,
    `  Set TOKENSAGE_NO_COMPRESS=1 to see full output`,
    `╚════════════════════════════════════════════════════════════════╝`,
    ``,
  ].join("\n");

  return [...head, marker, ...tail].join("\n");
}

let raw = "";
process.stdin.on("data", (c: Buffer) => { raw += c.toString(); });
process.stdin.on("end", async () => {
  try {
    if (process.env["TOKENSAGE_NO_COMPRESS"] === "1") process.exit(0);

    const event = JSON.parse(raw) as {
      tool_name?: string;
      tool_input?: Record<string, string>;
      tool_response?: unknown;
    };

    if (event.tool_name !== "Bash") process.exit(0);

    const output = extractOutput(event.tool_response);
    if (!output) process.exit(0);

    const originalTokens = countTokens(output);
    if (originalTokens < BASH_COMPRESS_THRESHOLD) process.exit(0);

    const compressed = compressBashOutput(output);
    const savings = calculateSavings(output, compressed);

    if (savings.savedPercent < MIN_SAVINGS_PCT) process.exit(0);

    // Track savings in dashboard (fire-and-forget)
    void fetch(`http://localhost:${dashPort}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "bash_compress", tokens: savings }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});

    // Replace what Claude sees with compressed output
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { updatedToolOutput: compressed },
    }));

  } catch { /* non-fatal — always let bash output through on error */ }
  process.exit(0);
});
