import { describe, it, expect, beforeEach } from "vitest";
import { sessionTracker } from "../src/analytics/session-tracker.js";

describe("sessionTracker", () => {
  beforeEach(() => {
    sessionTracker.resetSession();
  });

  it("starts with zero requests", () => {
    const stats = sessionTracker.getSessionStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.totalSavedTokens).toBe(0);
  });

  it("records tool usage", () => {
    sessionTracker.record("compress_file", { original: 1000, optimized: 200, saved: 800, savedPercent: 80 });
    const stats = sessionTracker.getSessionStats();
    expect(stats.totalRequests).toBe(1);
    expect(stats.toolUsage["compress_file"]).toBe(1);
  });

  it("accumulates multiple records", () => {
    sessionTracker.record("compress_file", { original: 1000, optimized: 200, saved: 800, savedPercent: 80 });
    sessionTracker.record("summarize_logs", { original: 500, optimized: 100, saved: 400, savedPercent: 80 });
    const stats = sessionTracker.getSessionStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.totalOriginalTokens).toBe(1500);
    expect(stats.totalSavedTokens).toBe(1200);
  });

  it("calculates correct savings percent", () => {
    sessionTracker.record("compress_file", { original: 1000, optimized: 400, saved: 600, savedPercent: 60 });
    const stats = sessionTracker.getSessionStats();
    expect(stats.savedPercent).toBe(60);
  });

  it("returns top saving tools sorted by savings", () => {
    sessionTracker.record("compress_file", { original: 1000, optimized: 200, saved: 800, savedPercent: 80 });
    sessionTracker.record("summarize_logs", { original: 500, optimized: 450, saved: 50, savedPercent: 10 });
    sessionTracker.record("compress_directory", { original: 2000, optimized: 100, saved: 1900, savedPercent: 95 });

    const top = sessionTracker.getTopSavingTools(2);
    expect(top[0]?.tool).toBe("compress_directory");
    expect(top[1]?.tool).toBe("compress_file");
  });

  it("resets session correctly", () => {
    sessionTracker.record("compress_file", { original: 1000, optimized: 200, saved: 800, savedPercent: 80 });
    sessionTracker.resetSession();
    const stats = sessionTracker.getSessionStats();
    expect(stats.totalRequests).toBe(0);
  });
});
