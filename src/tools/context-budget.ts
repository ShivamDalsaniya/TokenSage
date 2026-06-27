import { z } from "zod";
import { countTokens } from "../analytics/token-counter.js";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { ContextBudget } from "../types/index.js";

export const contextBudgetSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe("Label for this context item"),
        content: z.string().describe("The content to measure"),
        priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
      })
    )
    .min(1)
    .describe("Context items to analyze"),
  budgetTokens: z
    .number()
    .int()
    .min(100)
    .default(8000)
    .describe("Target token budget to fit within"),
  model: z
    .enum(["gpt-4", "gpt-3.5", "claude-3", "claude-2", "claude-haiku", "custom"])
    .default("claude-3")
    .describe("Target model for context window guidance"),
});

export type ContextBudgetInput = z.infer<typeof contextBudgetSchema>;

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4": 128_000,
  "gpt-3.5": 16_385,
  "claude-3": 200_000,
  "claude-2": 100_000,
  "claude-haiku": 200_000,
  "custom": 128_000,
};

function estimateCompressedTokens(
  originalTokens: number,
  priority: "critical" | "high" | "medium" | "low"
): number {
  const ratios: Record<string, number> = {
    critical: 0.9,  // keep most of critical content
    high: 0.6,
    medium: 0.3,
    low: 0.1,
  };
  return Math.round(originalTokens * ratios[priority]!);
}

function buildRecommendation(
  items: ContextBudgetInput["items"],
  breakdown: ContextBudget["breakdown"],
  budgetTokens: number,
  modelWindow: number
): string {
  const totalOriginal = breakdown.reduce((sum, b) => sum + b.originalTokens, 0);
  const totalOptimized = breakdown.reduce((sum, b) => sum + b.optimizedTokens, 0);
  const budgetUsed = Math.round((totalOptimized / budgetTokens) * 100);

  if (totalOptimized <= budgetTokens) {
    return `Context fits within budget after optimization. Using ${budgetUsed}% of ${budgetTokens.toLocaleString()} token budget. Safe to proceed.`;
  }

  const overBy = totalOptimized - budgetTokens;
  const lowItems = items.filter((i) => i.priority === "low");
  const mediumItems = items.filter((i) => i.priority === "medium");

  const parts: string[] = [`Over budget by ${overBy.toLocaleString()} tokens.`];

  if (lowItems.length > 0) {
    parts.push(`Remove low-priority items (${lowItems.map((i) => i.name).join(", ")}) to free space.`);
  }
  if (mediumItems.length > 0 && totalOptimized > budgetTokens) {
    parts.push(`Compress medium-priority items (${mediumItems.map((i) => i.name).join(", ")}).`);
  }
  if (totalOriginal <= modelWindow) {
    parts.push(`Full context fits in ${budgetTokens.toLocaleString()} window — consider increasing budget.`);
  } else {
    parts.push(`Total exceeds model context window of ${modelWindow.toLocaleString()} tokens — significant pruning needed.`);
  }

  return parts.join(" ");
}

export function handleContextBudget(input: ContextBudgetInput): ContextBudget {
  const modelWindow = MODEL_CONTEXT_WINDOWS[input.model] ?? 128_000;

  const breakdown = input.items.map((item) => {
    const originalTokens = countTokens(item.content);
    const optimizedTokens = estimateCompressedTokens(originalTokens, item.priority);
    return {
      item: item.name,
      originalTokens,
      optimizedTokens,
      priority: item.priority,
    };
  });

  const originalTokens = breakdown.reduce((sum, b) => sum + b.originalTokens, 0);
  const optimizedTokens = breakdown.reduce((sum, b) => sum + b.optimizedTokens, 0);
  const savedTokens = Math.max(0, originalTokens - optimizedTokens);
  const savedPercent = originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0;

  const recommendation = buildRecommendation(input.items, breakdown, input.budgetTokens, modelWindow);

  sessionTracker.record("context_budget", {
    original: originalTokens,
    optimized: optimizedTokens,
    saved: savedTokens,
    savedPercent,
  });

  return {
    originalTokens,
    optimizedTokens,
    savedTokens,
    savedPercent,
    breakdown,
    recommendation,
  };
}

export function formatContextBudgetOutput(result: ContextBudget): string {
  const lines: string[] = [
    "## Context Budget Analysis",
    "",
    `| Metric | Tokens |`,
    `|--------|--------|`,
    `| Original | ${result.originalTokens.toLocaleString()} |`,
    `| Optimized | ${result.optimizedTokens.toLocaleString()} |`,
    `| Saved | ${result.savedTokens.toLocaleString()} (${result.savedPercent}%) |`,
    "",
    "### Breakdown by Item",
    "",
    `| Item | Original | Optimized | Savings |`,
    `|------|----------|-----------|---------|`,
  ];

  for (const b of result.breakdown) {
    const savings = Math.max(0, b.originalTokens - b.optimizedTokens);
    const pct = b.originalTokens > 0 ? Math.round((savings / b.originalTokens) * 100) : 0;
    lines.push(`| ${b.item} | ${b.originalTokens.toLocaleString()} | ${b.optimizedTokens.toLocaleString()} | ${pct}% |`);
  }

  lines.push("");
  lines.push("### Recommendation");
  lines.push(result.recommendation);

  return lines.join("\n");
}
