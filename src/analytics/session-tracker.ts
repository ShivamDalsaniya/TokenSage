import { randomUUID } from "node:crypto";
import type { SessionStats, TokenCount } from "../types/index.js";

interface RequestRecord {
  tool: string;
  tokens: TokenCount;
  timestamp: string;
}

const MAX_REQUESTS = 10_000;

class SessionTracker {
  private sessionId: string;
  private startedAt: string;
  private requests: RequestRecord[] = [];
  private allTimeSavedTokens = 0;

  constructor() {
    this.sessionId = randomUUID();
    this.startedAt = new Date().toISOString();
  }

  record(tool: string, tokens: TokenCount): void {
    if (this.requests.length >= MAX_REQUESTS) {
      this.requests.shift();
    }
    this.requests.push({
      tool,
      tokens,
      timestamp: new Date().toISOString(),
    });
    this.allTimeSavedTokens += tokens.saved;
  }

  getSessionStats(): SessionStats {
    const totalOriginal = this.requests.reduce((sum, r) => sum + r.tokens.original, 0);
    const totalSaved = this.requests.reduce((sum, r) => sum + r.tokens.saved, 0);
    const totalOptimized = Math.max(0, totalOriginal - totalSaved);
    const savedPercent = totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0;

    const toolUsage: Record<string, number> = {};
    for (const req of this.requests) {
      toolUsage[req.tool] = (toolUsage[req.tool] ?? 0) + 1;
    }

    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      totalRequests: this.requests.length,
      totalOriginalTokens: totalOriginal,
      totalOptimizedTokens: totalOptimized,
      totalSavedTokens: totalSaved,
      savedPercent,
      toolUsage,
    };
  }

  getAllTimeSaved(): number {
    return this.allTimeSavedTokens;
  }

  getTopSavingTools(n = 5): Array<{ tool: string; savedTokens: number; originalTokens: number }> {
    const bySaving: Record<string, number> = {};
    const byOriginal: Record<string, number> = {};
    for (const req of this.requests) {
      bySaving[req.tool] = (bySaving[req.tool] ?? 0) + req.tokens.saved;
      byOriginal[req.tool] = (byOriginal[req.tool] ?? 0) + req.tokens.original;
    }
    return Object.entries(bySaving)
      .map(([tool, savedTokens]) => ({ tool, savedTokens, originalTokens: byOriginal[tool] ?? 0 }))
      .filter(t => t.savedTokens > 0)
      .sort((a, b) => b.savedTokens - a.savedTokens)
      .slice(0, n);
  }

  getRecentActivity(n = 20): Array<{
    tool: string;
    savedTokens: number;
    originalTokens: number;
    savedPercent: number;
    timestamp: string;
  }> {
    return this.requests
      .slice(-n)
      .reverse()
      .map(r => ({
        tool: r.tool,
        savedTokens: r.tokens.saved,
        originalTokens: r.tokens.original,
        savedPercent: r.tokens.savedPercent,
        timestamp: r.timestamp,
      }));
  }

  getLastRequest(): RequestRecord | undefined {
    return this.requests[this.requests.length - 1];
  }

  resetSession(): void {
    this.sessionId = randomUUID();
    this.startedAt = new Date().toISOString();
    this.requests = [];
  }
}

// Singleton session tracker
export const sessionTracker = new SessionTracker();
