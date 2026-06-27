import { z } from "zod";
import { compressLogs } from "../compression/log-compressor.js";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { CompressedLogs } from "../types/index.js";

export const summarizeLogsSchema = z.object({
  logs: z.string().describe("Raw log output to compress and summarize"),
  logType: z
    .enum(["npm", "docker", "build", "test", "terminal", "auto"])
    .default("auto")
    .describe("Type of log for specialized parsing"),
});

export type SummarizeLogsInput = z.infer<typeof summarizeLogsSchema>;

export function handleSummarizeLogs(input: SummarizeLogsInput): CompressedLogs {
  const result = compressLogs(input.logs);
  sessionTracker.record("summarize_logs", result.tokens);
  return result;
}

export function formatSummarizeLogsOutput(result: CompressedLogs): string {
  const statusEmoji = { success: "✅", warning: "⚠️", error: "❌", unknown: "❓" }[result.status];

  const lines: string[] = [
    `## Log Summary ${statusEmoji}`,
    `**Status:** ${result.status.toUpperCase()}`,
    `**Summary:** ${result.summary}`,
    "",
  ];

  if (result.errors.length > 0) {
    lines.push("### Errors");
    for (const err of result.errors.slice(0, 5)) {
      const repeat = err.count && err.count > 1 ? ` *(×${err.count})*` : "";
      lines.push(`- ${err.message.slice(0, 300)}${repeat}`);
    }
    if (result.errors.length > 5) lines.push(`- *… ${result.errors.length - 5} more errors*`);
    lines.push("");
  }

  if (result.warnings.length > 0) {
    lines.push("### Warnings");
    for (const warn of result.warnings.slice(0, 5)) {
      const repeat = warn.count && warn.count > 1 ? ` *(×${warn.count})*` : "";
      lines.push(`- ${warn.message.slice(0, 200)}${repeat}`);
    }
    if (result.warnings.length > 5) lines.push(`- *… ${result.warnings.length - 5} more warnings*`);
    lines.push("");
  }

  if (result.recommendedActions.length > 0) {
    lines.push("### Recommended Actions");
    for (const action of result.recommendedActions) {
      lines.push(`1. ${action}`);
    }
    lines.push("");
  }

  lines.push("### Token Savings");
  lines.push(`Original: **${result.tokens.original}** → Optimized: **${result.tokens.optimized}** (saved **${result.tokens.savedPercent}%**)`);

  return lines.join("\n");
}
