import { describe, it, expect } from "vitest";
import { countTokens, calculateSavings, formatTokens } from "../src/analytics/token-counter.js";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts tokens in a simple string", () => {
    const count = countTokens("Hello, world!");
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it("counts more tokens for longer content", () => {
    const short = countTokens("Hello");
    const long = countTokens("Hello world this is a longer sentence with many more tokens");
    expect(long).toBeGreaterThan(short);
  });

  it("handles code content", () => {
    const code = `function add(a: number, b: number): number { return a + b; }`;
    const count = countTokens(code);
    expect(count).toBeGreaterThan(5);
  });
});

describe("calculateSavings", () => {
  it("calculates savings between original and compressed", () => {
    const original = "a".repeat(1000);
    const optimized = "a".repeat(100);
    const savings = calculateSavings(original, optimized);
    expect(savings.saved).toBeGreaterThan(0);
    expect(savings.savedPercent).toBeGreaterThan(0);
    expect(savings.savedPercent).toBeLessThanOrEqual(100);
    expect(savings.original).toBeGreaterThan(savings.optimized);
  });

  it("returns 0 savings when equal", () => {
    const text = "same content here";
    const savings = calculateSavings(text, text);
    expect(savings.saved).toBe(0);
    expect(savings.savedPercent).toBe(0);
  });

  it("does not return negative savings", () => {
    // optimized longer than original
    const savings = calculateSavings("short", "this is much longer than the original content");
    expect(savings.saved).toBeGreaterThanOrEqual(0);
  });
});

describe("formatTokens", () => {
  it("formats small counts as-is", () => {
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(10000)).toBe("10.0k");
  });
});
