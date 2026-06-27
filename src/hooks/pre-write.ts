#!/usr/bin/env node
/**
 * TokenSage PreToolUse hook — Write Guard
 *
 * Intercepts Write on existing files. When a full rewrite would waste tokens,
 * computes a minimal line-diff and presents Edit-compatible hunks so the AI
 * can achieve the identical result at 5-30x lower token cost.
 *
 * Technical integrity: guaranteed — applying the emitted hunks to the existing
 * file produces byte-for-byte identical output to the original Write.
 *
 * Decision tree:
 *   • TOKENSAGE_NO_COMPRESS=1  → pass through
 *   • File does not exist       → pass through (new file, Write is correct)
 *   • File < MIN_FILE_LINES     → pass through (overhead not worth it)
 *   • File > MAX_LCS_LINES      → pass through (LCS too slow; avoid false blocks)
 *   • Edit saves < MIN_SAVINGS  → pass through (genuine full rewrite)
 *   • Otherwise                 → block, emit ordered Edit hunks
 *
 * Exit 0  → let Write proceed unchanged
 * Block   → AI sees diff instructions with exact old_string / new_string pairs
 */

import { readFileSync, existsSync } from "fs";
import { computeProjectPort } from "../config/index.js";

const _rawPort = parseInt(process.env["DASHBOARD_PORT"] ?? "", 10);
const dashPort = isNaN(_rawPort) ? computeProjectPort(process.cwd()) : _rawPort;

// ── Thresholds (env-overridable) ──────────────────────────────────────────
const MIN_FILE_LINES  = parseInt(process.env["TOKENSAGE_WRITE_MIN_LINES"]  ?? "50",  10);
const MAX_LCS_LINES   = parseInt(process.env["TOKENSAGE_WRITE_MAX_LINES"]  ?? "800", 10);
const MIN_SAVINGS_PCT = parseInt(process.env["TOKENSAGE_WRITE_MIN_SAVINGS"] ?? "40",  10);
const CONTEXT_LINES   = 3;  // surrounding lines per hunk (ensures uniqueness)
const MERGE_GAP       = 6;  // merge hunks separated by fewer than this many keep-lines

// ── Types ─────────────────────────────────────────────────────────────────
type DiffOp  = "keep" | "add" | "del";
interface DiffLine { op: DiffOp; line: string }
interface Hunk {
  oldStart: number;   // 0-indexed line in old file where hunk begins (incl. context)
  oldSlice: string[]; // lines from old file (context + deleted + context)
  newSlice: string[]; // lines for new file (context + added   + context)
}

// ── Token approximation (avoids importing full tokenizer) ─────────────────
// ~3.5 chars per token is conservative for code; accuracy not critical here.
function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ── LCS-based line diff ───────────────────────────────────────────────────
function lineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length, n = newLines.length;
  // Uint16Array caps at 65535 LCS length — sufficient for MAX_LCS_LINES=800
  const dp: Uint16Array[] = Array.from(
    { length: m + 1 },
    () => new Uint16Array(n + 1)
  );

  for (let i = 1; i <= m; i++) {
    const row  = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      row[j] = oldLines[i - 1] === newLines[j - 1]
        ? (prev[j - 1]! + 1)
        : Math.max(prev[j]!, row[j - 1]!);
    }
  }

  const ops: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ op: "keep", line: oldLines[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.unshift({ op: "add", line: newLines[j - 1]! });
      j--;
    } else {
      ops.unshift({ op: "del", line: oldLines[i - 1]! });
      i--;
    }
  }
  return ops;
}

// ── Build Edit-compatible hunks from diff ops ─────────────────────────────
function buildHunks(ops: DiffLine[], oldLines: string[]): Hunk[] {
  // Map each op to its 0-based index in the old file.
  // keep → advances old; del → advances old; add → does NOT advance old.
  const opToOldIdx: number[] = [];
  let oldIdx = 0;
  for (const op of ops) {
    opToOldIdx.push(op.op === "add" ? -1 : oldIdx);
    if (op.op !== "add") oldIdx++;
  }

  // Find runs of non-keep ops (change regions)
  interface ChangeRegion { opStart: number; opEnd: number }
  const regions: ChangeRegion[] = [];
  let inChange = false, regionStart = 0;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k]!.op !== "keep") {
      if (!inChange) { regionStart = k; inChange = true; }
    } else {
      if (inChange) { regions.push({ opStart: regionStart, opEnd: k - 1 }); inChange = false; }
    }
  }
  if (inChange) regions.push({ opStart: regionStart, opEnd: ops.length - 1 });
  if (regions.length === 0) return [];

  // Merge nearby regions (within MERGE_GAP keep-lines of each other)
  const merged: ChangeRegion[] = [regions[0]!];
  for (let r = 1; r < regions.length; r++) {
    const last = merged[merged.length - 1]!;
    const curr = regions[r]!;
    // Count keep-lines between last.opEnd and curr.opStart
    let keepsBetween = 0;
    for (let k = last.opEnd + 1; k < curr.opStart; k++) {
      if (ops[k]!.op === "keep") keepsBetween++;
    }
    if (keepsBetween < MERGE_GAP) {
      last.opEnd = curr.opEnd; // merge
    } else {
      merged.push(curr);
    }
  }

  // Convert each merged region to a Hunk
  const hunks: Hunk[] = [];
  for (const region of merged) {
    // Determine old-file line boundaries for context
    const firstOldIdx = (() => {
      for (let k = region.opStart; k <= region.opEnd; k++) {
        if (opToOldIdx[k]! >= 0) return opToOldIdx[k]!;
      }
      // All adds — anchor to the keep op just before
      for (let k = region.opStart - 1; k >= 0; k--) {
        if (opToOldIdx[k]! >= 0) return opToOldIdx[k]! + 1;
      }
      return 0;
    })();

    const lastOldIdx = (() => {
      for (let k = region.opEnd; k >= region.opStart; k--) {
        if (opToOldIdx[k]! >= 0) return opToOldIdx[k]!;
      }
      return firstOldIdx;
    })();

    const ctxStart = Math.max(0, firstOldIdx - CONTEXT_LINES);
    const ctxEnd   = Math.min(oldLines.length - 1, lastOldIdx + CONTEXT_LINES);

    // Build old slice (context + deleted lines + context)
    const oldSlice: string[] = [];
    const newSlice: string[] = [];

    // Leading context (same in both)
    for (let li = ctxStart; li < firstOldIdx; li++) {
      oldSlice.push(oldLines[li]!);
      newSlice.push(oldLines[li]!);
    }

    // Changed region
    for (let k = region.opStart; k <= region.opEnd; k++) {
      const { op, line } = ops[k]!;
      if (op === "del" || op === "keep") oldSlice.push(line);
      if (op === "add" || op === "keep") newSlice.push(line);
    }

    // Trailing context (same in both)
    for (let li = lastOldIdx + 1; li <= ctxEnd; li++) {
      oldSlice.push(oldLines[li]!);
      newSlice.push(oldLines[li]!);
    }

    hunks.push({ oldStart: ctxStart, oldSlice, newSlice });
  }

  return hunks;
}

// ── Verify correctness: applying hunks must reproduce newContent exactly ──
function verifyHunks(hunks: Hunk[], oldLines: string[], newLines: string[]): boolean {
  try {
    let result = oldLines.join("\n");
    for (const hunk of hunks) {
      const oldStr = hunk.oldSlice.join("\n");
      const newStr = hunk.newSlice.join("\n");
      if (!result.includes(oldStr)) return false;
      result = result.replace(oldStr, newStr);
    }
    return result === newLines.join("\n");
  } catch {
    return false;
  }
}

// ── Format block message ──────────────────────────────────────────────────
function formatBlock(
  filePath: string,
  oldLines: string[],
  newLines: string[],
  hunks: Hunk[],
  writeCost: number,
  editCost: number
): string {
  const savingsPct = Math.round((1 - editCost / writeCost) * 100);
  const lines: string[] = [
    `╔═ TokenSage Write Guard ════════════════════════════════════════╗`,
    `  ${filePath} already exists (${oldLines.length} lines).`,
    `  Full Write: ~${writeCost} tokens  |  Edit hunks: ~${editCost} tokens  |  Save: ${savingsPct}%`,
    `  Applying ${hunks.length} Edit hunk${hunks.length === 1 ? "" : "s"} produces identical file content.`,
    `╚════════════════════════════════════════════════════════════════╝`,
    ``,
    `Use the Edit tool with these hunks IN ORDER (do not skip any):`,
    ``,
  ];

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]!;
    const oldStr = hunk.oldSlice.join("\n");
    const newStr = hunk.newSlice.join("\n");
    lines.push(`── Hunk ${i + 1} of ${hunks.length} ──────────────────────────────────────────`);
    lines.push(`old_string: ${JSON.stringify(oldStr)}`);
    lines.push(`new_string: ${JSON.stringify(newStr)}`);
    lines.push(``);
  }

  lines.push(`All ${hunks.length} hunks applied = identical result to the Write, ${savingsPct}% fewer tokens.`);
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────
let raw = "";
process.stdin.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
process.stdin.on("end", async () => {
  if (process.env["TOKENSAGE_NO_COMPRESS"] === "1") process.exit(0);

  try {
    const event = JSON.parse(raw) as {
      tool_name?: string;
      tool_input?: { file_path?: string; content?: string };
    };

    if (event.tool_name !== "Write") process.exit(0);

    const filePath = event.tool_input?.file_path;
    const newContent = event.tool_input?.content;
    if (typeof filePath !== "string" || typeof newContent !== "string") process.exit(0);

    // New file — Write is the right tool
    if (!existsSync(filePath)) process.exit(0);

    let oldContent: string;
    try { oldContent = readFileSync(filePath, "utf-8"); }
    catch { process.exit(0); }

    // Identical content — nothing to do either way
    if (oldContent === newContent) process.exit(0);

    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    // Size guards
    if (oldLines.length < MIN_FILE_LINES) process.exit(0);
    if (oldLines.length > MAX_LCS_LINES || newLines.length > MAX_LCS_LINES) process.exit(0);

    // Compute diff
    const ops = lineDiff(oldLines, newLines);
    const hunks = buildHunks(ops, oldLines);
    if (hunks.length === 0) process.exit(0);

    // Estimate token costs
    const writeCost = approxTokens(newContent);
    const editCost  = hunks.reduce(
      (sum, h) => sum + approxTokens(h.oldSlice.join("\n")) + approxTokens(h.newSlice.join("\n")),
      0
    );

    // Not worth blocking if savings are negligible
    const savingsPct = Math.round((1 - editCost / writeCost) * 100);
    if (savingsPct < MIN_SAVINGS_PCT) process.exit(0);

    // Safety check: verify hunks reproduce the intended content exactly
    if (!verifyHunks(hunks, oldLines, newLines)) process.exit(0);

    // Track savings to dashboard
    const saved = writeCost - editCost;
    await fetch(`http://localhost:${dashPort}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "write_guard",
        tokens: { original: writeCost, optimized: editCost, saved, savedPercent: savingsPct },
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {}); // non-fatal

    // Block with diff instructions
    const reason = formatBlock(filePath, oldLines, newLines, hunks, writeCost, editCost);
    process.stdout.write(JSON.stringify({ decision: "block", reason }));

  } catch {
    process.exit(0); // Never block on errors — let Write proceed
  }
});
