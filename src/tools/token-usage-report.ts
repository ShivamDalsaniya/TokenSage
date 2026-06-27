import { z } from "zod";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { TokenUsageReport, TokenCount } from "../types/index.js";

export const tokenUsageReportSchema = z.object({
  includeCurrentRequest: z.boolean().default(true).describe("Include the most recent request stats"),
  resetAfter: z.boolean().default(false).describe("Reset session counters after reporting"),
});

export type TokenUsageReportInput = z.infer<typeof tokenUsageReportSchema>;

export function handleTokenUsageReport(input: TokenUsageReportInput): TokenUsageReport {
  const currentSession = sessionTracker.getSessionStats();
  const allTimeSaved = sessionTracker.getAllTimeSaved();
  const topSavingTools = sessionTracker.getTopSavingTools(5);

  let currentRequest: TokenCount | undefined;
  if (input.includeCurrentRequest) {
    const last = sessionTracker.getLastRequest();
    if (last) {
      currentRequest = last.tokens;
    }
  }

  if (input.resetAfter) {
    sessionTracker.resetSession();
  }

  return {
    currentRequest,
    currentSession,
    allTimeSaved,
    topSavingTools,
  };
}

export function formatTokenUsageReportOutput(result: TokenUsageReport): string {
  const { currentSession } = result;

  const lines: string[] = [
    "## Token Usage Report",
    "",
  ];

  if (result.currentRequest) {
    lines.push("### Current Request");
    lines.push(`- Original: **${result.currentRequest.original.toLocaleString()}** tokens`);
    lines.push(`- Optimized: **${result.currentRequest.optimized.toLocaleString()}** tokens`);
    lines.push(`- Saved: **${result.currentRequest.saved.toLocaleString()}** tokens (**${result.currentRequest.savedPercent}%**)`);
    lines.push("");
  }

  lines.push("### Current Session");
  lines.push(`- Session ID: \`${currentSession.sessionId}\``);
  lines.push(`- Started: ${currentSession.startedAt}`);
  lines.push(`- Total requests: **${currentSession.totalRequests}**`);
  lines.push(`- Original tokens: **${currentSession.totalOriginalTokens.toLocaleString()}**`);
  lines.push(`- Optimized tokens: **${currentSession.totalOptimizedTokens.toLocaleString()}**`);
  lines.push(`- Saved: **${currentSession.totalSavedTokens.toLocaleString()}** tokens (**${currentSession.savedPercent}%**)`);
  lines.push("");

  if (Object.keys(currentSession.toolUsage).length > 0) {
    lines.push("### Tool Usage");
    const sortedTools = Object.entries(currentSession.toolUsage)
      .sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of sortedTools) {
      lines.push(`- \`${tool}\`: ${count} call${count !== 1 ? "s" : ""}`);
    }
    lines.push("");
  }

  if (result.topSavingTools.length > 0) {
    lines.push("### Top Token-Saving Tools");
    for (let i = 0; i < result.topSavingTools.length; i++) {
      const t = result.topSavingTools[i]!;
      lines.push(`${i + 1}. \`${t.tool}\`: ${t.savedTokens.toLocaleString()} tokens saved`);
    }
    lines.push("");
  }

  lines.push("### All-Time Savings");
  lines.push(`Total saved across all sessions: **${result.allTimeSaved.toLocaleString()}** tokens`);

  if (currentSession.savedPercent >= 50) {
    lines.push("\n🎯 **TokenSage target achieved:** ≥50% reduction in tokens!");
  }

  return lines.join("\n");
}
