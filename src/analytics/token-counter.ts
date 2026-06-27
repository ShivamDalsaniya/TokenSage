/**
 * Token counting using gpt-tokenizer (cl100k_base encoding).
 * Compatible with GPT-4, Claude, and similar models.
 */
import { encode } from "gpt-tokenizer";

/**
 * Count tokens in a string using cl100k_base encoding.
 * Falls back to character-based estimation if encoding fails.
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  try {
    return encode(text).length;
  } catch {
    // Fallback: ~4 chars per token (rough average for English/code)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Calculate token savings between original and optimized content.
 */
export function calculateSavings(original: string, optimized: string) {
  const originalTokens = countTokens(original);
  const optimizedTokens = countTokens(optimized);
  const saved = Math.max(0, originalTokens - optimizedTokens);
  const savedPercent = originalTokens > 0 ? Math.round((saved / originalTokens) * 100) : 0;

  return {
    original: originalTokens,
    optimized: optimizedTokens,
    saved,
    savedPercent,
  };
}

/**
 * Estimate tokens for structured data by serializing to JSON.
 */
export function estimateObjectTokens(obj: unknown): number {
  return countTokens(JSON.stringify(obj, null, 0));
}

/**
 * Format token count for display.
 */
export function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}
