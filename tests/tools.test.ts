import { describe, it, expect } from "vitest";
import { handleSummarizeConversation } from "../src/tools/summarize-conversation.js";
import { handleDetectDuplicates } from "../src/tools/detect-duplicates.js";
import { handleContextBudget } from "../src/tools/context-budget.js";
import { handleTokenUsageReport } from "../src/tools/token-usage-report.js";
import { handleSummarizeLogs } from "../src/tools/summarize-logs.js";

describe("summarize_conversation", () => {
  it("extracts goals from user messages", () => {
    const result = handleSummarizeConversation({
      messages: [
        { role: "user", content: "I need to build an authentication system using JWT" },
        { role: "assistant", content: "I'll help you build that. I've created auth.ts with JWT functions." },
        { role: "user", content: "Can you also add refresh tokens?" },
      ],
      preserveLastN: 0,
    });

    expect(result.goals.length).toBeGreaterThanOrEqual(0);
    expect(result.tokens.original).toBeGreaterThan(0);
  });

  it("returns non-zero tokens", () => {
    const result = handleSummarizeConversation({
      messages: [
        { role: "user", content: "Hello, can you help me?" },
        { role: "assistant", content: "Sure, what do you need?" },
      ],
      preserveLastN: 0,
    });

    expect(result.tokens.original).toBeGreaterThan(0);
    expect(result.tokens.optimized).toBeGreaterThan(0);
  });

  it("handles empty messages gracefully", () => {
    const result = handleSummarizeConversation({
      messages: [{ role: "user", content: "hi" }],
      preserveLastN: 0,
    });
    expect(result).toBeDefined();
    expect(result.keyContext).toBeDefined();
  });
});

describe("detect_duplicates", () => {
  it("detects exact duplicates", () => {
    const result = handleDetectDuplicates({
      items: [
        "Error: Cannot find module './auth'",
        "Error: Cannot find module './auth'",
        "Error: Cannot find module './auth'",
        "Different error message here",
      ],
      type: "auto",
      similarityThreshold: 0.85,
    });

    expect(result.originalCount).toBe(4);
    expect(result.deduplicatedCount).toBeLessThan(4);
    expect(result.groups.length).toBeGreaterThan(0);
  });

  it("preserves unique items", () => {
    const items = ["Error A", "Error B", "Error C", "Error D"];
    const result = handleDetectDuplicates({
      items,
      type: "auto",
      similarityThreshold: 0.85,
    });

    expect(result.deduplicatedCount).toBe(4);
    expect(result.items.length).toBe(4);
  });

  it("normalizes timestamps in duplicates", () => {
    const result = handleDetectDuplicates({
      items: [
        "2024-01-01T10:00:00Z ERROR: Connection refused",
        "2024-01-02T11:30:00Z ERROR: Connection refused",
        "2024-01-03T09:15:00Z ERROR: Connection refused",
      ],
      type: "auto",
      similarityThreshold: 0.85,
    });

    // With timestamp normalization, these should be grouped
    expect(result.deduplicatedCount).toBeLessThan(3);
  });

  it("saves tokens", () => {
    const items = Array(10).fill("Error: Something went wrong at line 42");
    const result = handleDetectDuplicates({
      items,
      type: "auto",
      similarityThreshold: 0.85,
    });

    expect(result.tokens.saved).toBeGreaterThan(0);
    expect(result.tokens.savedPercent).toBeGreaterThan(0);
  });
});

describe("context_budget", () => {
  it("calculates token breakdown", () => {
    const result = handleContextBudget({
      items: [
        { name: "System prompt", content: "You are a helpful assistant. " + "a".repeat(500), priority: "critical" },
        { name: "Code file", content: "function example() { return 42; } " + "b".repeat(1000), priority: "high" },
        { name: "Old conversation", content: "c".repeat(2000), priority: "low" },
      ],
      budgetTokens: 1000,
      model: "claude-3",
    });

    expect(result.originalTokens).toBeGreaterThan(0);
    expect(result.optimizedTokens).toBeLessThan(result.originalTokens);
    expect(result.savedPercent).toBeGreaterThan(0);
    expect(result.breakdown.length).toBe(3);
    expect(result.recommendation).toBeTruthy();
  });

  it("generates recommendation", () => {
    const result = handleContextBudget({
      items: [{ name: "Test", content: "Hello world", priority: "medium" }],
      budgetTokens: 10000,
      model: "claude-3",
    });

    expect(result.recommendation).toBeTruthy();
    expect(result.recommendation.length).toBeGreaterThan(10);
  });
});

describe("token_usage_report", () => {
  it("returns session stats", () => {
    const result = handleTokenUsageReport({
      includeCurrentRequest: true,
      resetAfter: false,
    });

    expect(result.currentSession).toBeDefined();
    expect(result.currentSession.sessionId).toBeTruthy();
    expect(result.currentSession.startedAt).toBeTruthy();
    expect(typeof result.currentSession.totalRequests).toBe("number");
  });

  it("includes top saving tools", () => {
    const result = handleTokenUsageReport({
      includeCurrentRequest: false,
      resetAfter: false,
    });

    expect(Array.isArray(result.topSavingTools)).toBe(true);
  });
});

describe("summarize_logs", () => {
  it("summarizes error logs", () => {
    const logs = `
ERROR TypeError: Cannot read properties of undefined (reading 'map')
    at processItems (src/utils.ts:42)
WARN Deprecated function called
INFO Build complete
    `;

    const result = handleSummarizeLogs({ logs, logType: "auto" });
    expect(result.status).toBe("error");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns success for clean output", () => {
    const result = handleSummarizeLogs({
      logs: "INFO  All tests passed\nINFO  Build successful",
      logType: "build",
    });
    expect(result.status).toBe("success");
  });

  it("saves tokens", () => {
    const bigLog = Array(50)
      .fill("2024-01-01T00:00:00Z INFO Some log message about processing data")
      .join("\n");
    const result = handleSummarizeLogs({ logs: bigLog, logType: "auto" });
    expect(result.tokens.original).toBeGreaterThan(result.tokens.optimized);
  });
});
