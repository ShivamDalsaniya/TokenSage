import { z } from "zod";
import { createHash } from "node:crypto";
import { calculateSavings } from "../analytics/token-counter.js";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { DeduplicatedResult, DuplicateGroup } from "../types/index.js";

export const detectDuplicatesSchema = z.object({
  items: z
    .array(z.string())
    .min(1)
    .describe("Array of strings (stack traces, messages, context chunks) to deduplicate"),
  type: z
    .enum(["stack-trace", "file", "tool-output", "message", "context-chunk", "auto"])
    .default("auto")
    .describe("Type of content for specialized deduplication"),
  similarityThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.85)
    .describe("Similarity threshold (0-1) for fuzzy deduplication"),
});

export type DetectDuplicatesInput = z.infer<typeof detectDuplicatesSchema>;

/**
 * Normalize content for comparison — removes timestamps, addresses, line numbers.
 */
function normalize(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<timestamp>")
    .replace(/0x[0-9a-fA-F]{4,}/g, "<addr>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "<uuid>")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Compute SHA-256 hash of normalized content.
 */
function hashContent(text: string): string {
  return createHash("sha256").update(normalize(text)).digest("hex").slice(0, 12);
}

/**
 * Simple Jaccard similarity on word sets.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalize(a).split(/\s+/));
  const wordsB = new Set(normalize(b).split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

/**
 * Detect type of item (stack trace, log line, etc.)
 */
function detectItemType(item: string): DuplicateGroup["type"] {
  if (/^\s*at\s+\w+|Traceback \(most recent|Error:\s+/.test(item)) return "stack-trace";
  if (/^(?:✓|✗|PASS|FAIL|ok|error|warn)\s+/.test(item)) return "tool-output";
  if (/^(?:user|assistant|system):\s+/.test(item)) return "message";
  return "context-chunk";
}

export function handleDetectDuplicates(input: DetectDuplicatesInput): DeduplicatedResult {
  const { items, type, similarityThreshold } = input;

  const originalText = items.join("\n---\n");

  // Group by exact normalized hash
  const hashGroups = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    const hash = hashContent(items[i] ?? "");
    const group = hashGroups.get(hash) ?? [];
    group.push(i);
    hashGroups.set(hash, group);
  }

  // Find near-duplicates using Jaccard similarity
  const processed = new Set<number>();
  const groups: DuplicateGroup[] = [];
  const uniqueIndices: number[] = [];

  for (const [hash, indices] of hashGroups) {
    if (indices.length === 0) continue;

    const representativeIdx = indices[0]!;
    const item = items[representativeIdx] ?? "";

    if (indices.length > 1) {
      // Exact duplicates
      groups.push({
        hash,
        type: type === "auto" ? detectItemType(item) : (type as DuplicateGroup["type"]),
        count: indices.length,
        items: indices.map((i) => items[i] ?? ""),
        representative: item,
      });
      indices.forEach((i) => processed.add(i));
      uniqueIndices.push(representativeIdx);
    } else {
      // Check for fuzzy duplicates
      const idx = indices[0]!;
      if (processed.has(idx)) continue;

      let mergedInto = -1;
      for (const [existingHash, existingGroup] of hashGroups) {
        if (existingHash === hash || existingGroup.length === 0) continue;
        const existingRep = items[existingGroup[0]!] ?? "";
        if (jaccardSimilarity(item, existingRep) >= similarityThreshold) {
          mergedInto = existingGroup[0]!;
          break;
        }
      }

      if (mergedInto >= 0) {
        // Near-duplicate found — merge into existing group
        const existingGroup = groups.find((g) => g.representative === (items[mergedInto] ?? ""));
        if (existingGroup) {
          existingGroup.count++;
          existingGroup.items.push(item);
        }
        processed.add(idx);
      } else {
        processed.add(idx);
        uniqueIndices.push(idx);
      }
    }
  }

  // Build unique items list
  const uniqueItems = uniqueIndices.map((i) => items[i] ?? "");

  const deduplicatedText = uniqueItems.join("\n---\n");
  const tokens = calculateSavings(originalText, deduplicatedText);
  sessionTracker.record("detect_duplicates", tokens, `${input.items.length} items`);

  return {
    originalCount: items.length,
    deduplicatedCount: uniqueItems.length,
    groups,
    items: uniqueItems,
    tokens,
  };
}

export function formatDetectDuplicatesOutput(result: DeduplicatedResult): string {
  const lines: string[] = [
    "## Deduplication Results",
    "",
    `- **Original items:** ${result.originalCount}`,
    `- **Unique items:** ${result.deduplicatedCount}`,
    `- **Removed:** ${result.originalCount - result.deduplicatedCount} duplicates`,
    "",
  ];

  if (result.groups.length > 0) {
    lines.push("### Duplicate Groups");
    for (const group of result.groups.slice(0, 10)) {
      lines.push(`- **${group.type}** (×${group.count}): \`${group.representative.slice(0, 100)}…\``);
    }
    if (result.groups.length > 10) lines.push(`- … and ${result.groups.length - 10} more groups`);
    lines.push("");
  }

  lines.push("### Token Savings");
  lines.push(`Original: **${result.tokens.original}** → Optimized: **${result.tokens.optimized}** (saved **${result.tokens.savedPercent}%**)`);

  return lines.join("\n");
}
