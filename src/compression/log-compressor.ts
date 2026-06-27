import { calculateSavings } from "../analytics/token-counter.js";
import type { CompressedLogs, LogEntry } from "../types/index.js";

/**
 * Detect log level from a line.
 */
function detectLevel(line: string): LogEntry["level"] | null {
  const lower = line.toLowerCase();
  if (/\b(?:error|err|fatal|exception|traceback|panic)\b/.test(lower)) return "error";
  if (/\b(?:warn(?:ing)?)\b/.test(lower)) return "warn";
  if (/\b(?:info|success|done|complete)\b/.test(lower)) return "info";
  if (/\b(?:debug|trace|verbose)\b/.test(lower)) return "debug";
  return null;
}

/**
 * Extract stack trace frames (collapse identical frames).
 */
function extractStackTrace(lines: string[], startIdx: number): { frames: string[]; endIdx: number } {
  const frames: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i]?.trim() ?? "";
    if (/^\s*at\s+|^\s*File\s+"|^\s+\w+\.py:\d+/.test(line)) {
      if (frames.length < 5) frames.push(line.trim());
      i++;
    } else {
      break;
    }
  }
  return { frames, endIdx: i };
}

/**
 * Deduplicate similar log lines.
 */
function deduplicateLines(entries: LogEntry[]): LogEntry[] {
  const seen = new Map<string, LogEntry>();
  for (const entry of entries) {
    // Normalize: use first line only (ignore stack frames), remove timestamps/addresses/numbers
    const firstLine = entry.message.split("\n")[0] ?? entry.message;
    const key = firstLine
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "<ts>")
      .replace(/0x[0-9a-fA-F]+/g, "<addr>")
      .replace(/:\d+/g, ":<n>")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();

    const existing = seen.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
    } else {
      seen.set(key, { ...entry, count: 1 });
    }
  }
  return Array.from(seen.values());
}

/**
 * Determine overall status from log entries.
 */
function determineStatus(errors: LogEntry[], warnings: LogEntry[]): CompressedLogs["status"] {
  if (errors.length > 0) return "error";
  if (warnings.length > 0) return "warning";
  return "success";
}

/**
 * Generate recommended actions based on errors/warnings.
 */
function generateRecommendations(errors: LogEntry[], warnings: LogEntry[]): string[] {
  const actions: string[] = [];

  for (const err of errors.slice(0, 5)) {
    const msg = err.message.toLowerCase();

    if (/cannot find module|module not found|no such file/.test(msg)) {
      actions.push("Run `npm install` or check import paths");
    } else if (/permission denied|eacces/.test(msg)) {
      actions.push("Check file permissions");
    } else if (/econnrefused|connection refused/.test(msg)) {
      actions.push("Verify service is running and port is correct");
    } else if (/out of memory|heap|oom/.test(msg)) {
      actions.push("Increase Node.js heap with `--max-old-space-size`");
    } else if (/type error|typeerror/.test(msg)) {
      actions.push("Fix TypeScript type error — check function signatures");
    } else if (/syntax error/.test(msg)) {
      actions.push("Fix syntax error in source file");
    } else if (/timeout|timed out/.test(msg)) {
      actions.push("Check network/service availability or increase timeout");
    } else if (/undefined|null/.test(msg)) {
      actions.push("Add null check or verify data is populated before access");
    }
  }

  if (warnings.some((w) => /deprecated/.test(w.message.toLowerCase()))) {
    actions.push("Update deprecated APIs");
  }

  return [...new Set(actions)].slice(0, 5);
}

/**
 * Compress log output to structured summary.
 */
export function compressLogs(rawLogs: string): CompressedLogs {
  const lines = rawLogs.split("\n");
  const allErrors: LogEntry[] = [];
  const allWarnings: LogEntry[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]?.trim() ?? "";
    if (!line) { i++; continue; }

    const level = detectLevel(line);

    if (level === "error") {
      // Check for multi-line stack trace
      const { frames, endIdx } = extractStackTrace(lines, i + 1);
      const message = frames.length > 0
        ? `${line}\n  ${frames.slice(0, 3).join("\n  ")}${frames.length > 3 ? `\n  … (${frames.length - 3} more frames)` : ""}`
        : line;
      allErrors.push({ level: "error", message });
      i = endIdx;
    } else if (level === "warn") {
      allWarnings.push({ level: "warn", message: line });
      i++;
    } else {
      i++;
    }
  }

  const errors = deduplicateLines(allErrors);
  const warnings = deduplicateLines(allWarnings);
  const status = determineStatus(errors, warnings);

  const summaryParts: string[] = [
    `Status: ${status}`,
    errors.length > 0 ? `${errors.length} unique error${errors.length !== 1 ? "s" : ""}` : "No errors",
    warnings.length > 0 ? `${warnings.length} unique warning${warnings.length !== 1 ? "s" : ""}` : "No warnings",
  ];

  const compressed = [
    summaryParts.join(". "),
    ...errors.slice(0, 3).map((e) => `ERROR: ${e.message.slice(0, 200)}${e.count && e.count > 1 ? ` (×${e.count})` : ""}`),
    ...warnings.slice(0, 3).map((w) => `WARN: ${w.message.slice(0, 150)}${w.count && w.count > 1 ? ` (×${w.count})` : ""}`),
  ].join("\n");

  const tokens = calculateSavings(rawLogs, compressed);

  return {
    status,
    errors: errors.slice(0, 10),
    warnings: warnings.slice(0, 10),
    summary: summaryParts.join(". "),
    recommendedActions: generateRecommendations(errors, warnings),
    tokens,
  };
}
