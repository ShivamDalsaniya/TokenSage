#!/usr/bin/env node
/**
 * TokenSage UserPromptSubmit hook — compresses large code/log blocks embedded
 * in user prompts, then replaces the prompt with a compressed version.
 *
 * Rules:
 *  - Only fires when prompt exceeds MIN_PROMPT_TOKENS
 *  - Only compresses fenced code blocks (``` ... ```) that exceed MIN_BLOCK_LINES
 *  - Log-like blocks → compressLogs; code blocks → compressContent
 *  - Block replaced only when savings exceed MIN_SAVINGS_PCT
 *  - Outputs {"prompt": "..."} to replace prompt, or exits 0 to pass through
 *  - Always exits 0 (never blocks submission)
 *  - Skipped when TOKENSAGE_NO_COMPRESS=1
 */
import { countTokens, calculateSavings } from "../analytics/token-counter.js";
import { compressContent } from "../compression/code-compressor.js";
import { compressLogs } from "../compression/log-compressor.js";
import { computeProjectPort } from "../config/index.js";

const _rawPort = parseInt(process.env["DASHBOARD_PORT"] ?? "", 10);
const dashPort = isNaN(_rawPort) ? computeProjectPort(process.cwd()) : _rawPort;

const MIN_BLOCK_LINES   = parseInt(process.env["TOKENSAGE_PROMPT_MIN_LINES"]  ?? "30",  10);
const MIN_SAVINGS_PCT   = parseInt(process.env["TOKENSAGE_MIN_SAVINGS_PCT"]   ?? "20",  10);

const LOG_PATTERN = /\b(?:error|warn(?:ing)?|info|debug|fatal|npm ERR!|stdout|stderr)\b.*:/i;
const TIMESTAMP_PATTERN = /\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}/;

function looksLikeLogs(content: string): boolean {
  const lines = content.split("\n").slice(0, 20);
  const logLines = lines.filter(l => LOG_PATTERN.test(l) || TIMESTAMP_PATTERN.test(l));
  return logLines.length >= Math.min(3, lines.length * 0.3);
}

/** Replace fenced code/log blocks with compressed summaries. Returns null if no savings. */
function compressPrompt(prompt: string): { compressed: string; savedTokens: number } | null {
  // Match fenced blocks: ```[lang]\n content \n```
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;
  let result = prompt;
  let totalSaved = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(prompt)) !== null) {
    const [fullBlock, lang, content] = match as unknown as [string, string, string];
    const lines = content.split("\n");

    if (lines.length < MIN_BLOCK_LINES) continue;

    let compressedContent: string;
    let savedPercent: number;

    if (looksLikeLogs(content)) {
      const res = compressLogs(content);
      compressedContent = [
        `[TokenSage: log compressed — ${res.status}, ${res.errors.length} errors, ${res.warnings.length} warnings]`,
        res.summary,
        ...res.errors.slice(0, 3).map(e => `ERROR: ${e.message.slice(0, 200)}${e.count && e.count > 1 ? ` (×${e.count})` : ""}`),
        ...res.warnings.slice(0, 3).map(w => `WARN: ${w.message.slice(0, 150)}${w.count && w.count > 1 ? ` (×${w.count})` : ""}`),
        res.recommendedActions.length > 0 ? `Recommended: ${res.recommendedActions.join("; ")}` : "",
      ].filter(Boolean).join("\n");
      savedPercent = res.tokens.savedPercent;
    } else {
      // Treat as code — use lang hint or "unknown"
      const fakePath = lang ? `file.${lang}` : "file.ts";
      const res = compressContent(content, fakePath);
      compressedContent = [
        `[TokenSage: code compressed — ${res.language}, ${res.symbols.length} symbols, ${res.tokens.savedPercent}% saved]`,
        `Purpose: ${res.purpose}`,
        res.imports.length > 0 ? `Imports: ${res.imports.map(i => i.source).join(", ")}` : "",
        res.exports.length > 0 ? `Exports: ${res.exports.join(", ")}` : "",
        res.symbols.length > 0
          ? `Symbols: ${res.symbols.map(s => `${s.exported ? "export " : ""}${s.async ? "async " : ""}${s.kind} ${s.name}`).join(", ")}`
          : "",
      ].filter(Boolean).join("\n");
      savedPercent = res.tokens.savedPercent;
    }

    if (savedPercent < MIN_SAVINGS_PCT) continue;

    const savings = calculateSavings(content, compressedContent);
    totalSaved += savings.saved;

    const replacement = `\`\`\`${lang}\n${compressedContent}\n\`\`\``;
    result = result.replace(fullBlock, replacement);
  }

  return totalSaved > 0 ? { compressed: result, savedTokens: totalSaved } : null;
}

let raw = "";
process.stdin.on("data", (c: Buffer) => { raw += c.toString(); });
process.stdin.on("end", async () => {
  try {
    if (process.env["TOKENSAGE_NO_COMPRESS"] === "1") process.exit(0);
    const event = JSON.parse(raw) as { prompt?: string };
    const prompt = event.prompt ?? "";
    if (!prompt) process.exit(0);

    const originalTokens = countTokens(prompt);

    const compressionResult = compressPrompt(prompt);

    if (!compressionResult) {
      // No compressible blocks — track only
      await fetch(`http://localhost:${dashPort}/api/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "user_prompt", tokens: { original: originalTokens, optimized: originalTokens, saved: 0, savedPercent: 0 } }),
        signal: AbortSignal.timeout(2000),
      }).catch(() => {});
      process.exit(0);
    }

    const { compressed, savedTokens } = compressionResult;
    const optimizedTokens = originalTokens - savedTokens;
    const savedPercent = Math.round((savedTokens / originalTokens) * 100);

    // Track savings
    await fetch(`http://localhost:${dashPort}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "user_prompt",
        tokens: { original: originalTokens, optimized: optimizedTokens, saved: savedTokens, savedPercent },
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});

    // Replace prompt with compressed version
    process.stdout.write(JSON.stringify({ prompt: compressed }));

  } catch { /* non-fatal — always let prompt through */ }
  process.exit(0);
});
