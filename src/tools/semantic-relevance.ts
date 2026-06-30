import { z } from "zod";
import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { countTokens } from "../analytics/token-counter.js";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { SemanticRelevanceResult, FileRelevance } from "../types/index.js";

export const semanticRelevanceSchema = z.object({
  query: z.string().min(1).describe("Search query or description of what you're looking for"),
  directory: z.string().describe("Directory to search in"),
  topK: z.number().int().min(1).max(50).default(10).describe("Number of top relevant files to return"),
  fileExtensions: z
    .array(z.string())
    .default([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"])
    .describe("File extensions to include"),
});

export type SemanticRelevanceInput = z.infer<typeof semanticRelevanceSchema>;

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "__pycache__", ".cache", "vendor",
]);

async function collectFiles(dir: string, extensions: Set<string>, collected: string[] = []): Promise<string[]> {
  if (collected.length >= 500) return collected;

  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    const entryName = entry.name;
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entryName) || entryName.startsWith(".")) continue;
      await collectFiles(join(dir, entryName), extensions, collected);
    } else if (entry.isFile()) {
      if (extensions.has(extname(entryName))) {
        collected.push(join(dir, entryName));
      }
    }
  }

  return collected;
}

/**
 * Tokenize query into meaningful terms (remove stop words).
 */
function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "of", "in", "to", "for",
    "on", "at", "by", "from", "with", "about", "into", "through", "and",
    "or", "but", "not", "this", "that", "it", "its",
  ]);

  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Score a file by relevance to query terms.
 */
function scoreFile(
  filePath: string,
  relPath: string,
  content: string,
  queryTerms: string[]
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const lowerPath = relPath.toLowerCase();
  const lowerContent = content.toLowerCase();

  for (const term of queryTerms) {
    // Path match (high weight)
    if (lowerPath.includes(term)) {
      score += 10;
      reasons.push(`Path contains "${term}"`);
    }

    // Filename match (very high weight)
    const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";
    if (fileName.includes(term)) {
      score += 15;
    }

    // Content frequency — normalize by file length to avoid large-file bias
    const contentMatches = (lowerContent.match(new RegExp(`\\b${escapeRegex(term)}\\b`, "g")) ?? []).length;
    if (contentMatches > 0) {
      const lineCount = Math.max(1, lowerContent.split("\n").length);
      const normalizedFreq = contentMatches / Math.log2(lineCount + 2); // log-normalize
      const contentScore = Math.min(Math.round(normalizedFreq * 4), 20);
      score += contentScore;
      if (contentMatches >= 3) reasons.push(`"${term}" appears ${contentMatches}x`);
    }

    // Export/function name match (high value)
    const exportMatch =
      new RegExp(`export\\s+(?:default\\s+)?(?:function|class|const|type|interface)\\s+\\w*${escapeRegex(term)}\\w*`, "i").test(content) ||
      new RegExp(`def\\s+\\w*${escapeRegex(term)}\\w*`, "i").test(content) ||
      new RegExp(`func\\s+\\w*${escapeRegex(term)}\\w*`, "i").test(content);
    if (exportMatch) {
      score += 20;
      reasons.push(`Exports symbol matching "${term}"`);
    }
  }

  // Boost for important files
  if (/index\.(ts|js|py)$/.test(relPath)) score += 5;
  if (/^src\//.test(relPath)) score += 3;

  return { score, reasons: [...new Set(reasons)] };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function handleSemanticRelevance(input: SemanticRelevanceInput): Promise<SemanticRelevanceResult> {
  const extensions = new Set(input.fileExtensions);
  const files = await collectFiles(input.directory, extensions);

  const queryTerms = tokenizeQuery(input.query);
  const results: FileRelevance[] = [];
  let originalTokens = countTokens(input.query);

  for (const filePath of files) {
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > 100 * 1024) continue; // skip large files

      const content = await readFile(filePath, "utf-8");
      originalTokens += Math.ceil(fileStat.size / 4); // estimate tokens from size

      const relPath = relative(input.directory, filePath);
      const { score, reasons } = scoreFile(filePath, relPath, content, queryTerms);

      if (score > 0) {
        results.push({ path: relPath, score, reasons });
      }
    } catch {
      continue;
    }
  }

  // Sort by score descending, take top k
  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, input.topK);

  const optimizedTokens = countTokens(
    topResults.map((r) => `${r.path}: ${r.reasons.join(", ")}`).join("\n")
  );

  const tokens = {
    original: originalTokens,
    optimized: optimizedTokens,
    saved: Math.max(0, originalTokens - optimizedTokens),
    savedPercent: originalTokens > 0 ? Math.round(((originalTokens - optimizedTokens) / originalTokens) * 100) : 0,
  };

  sessionTracker.record("semantic_relevance", tokens, input.directory.split("/").pop() ?? input.directory);

  return { query: input.query, results: topResults, tokens };
}

export function formatSemanticRelevanceOutput(result: SemanticRelevanceResult): string {
  const lines: string[] = [
    `## Semantic Relevance: "${result.query}"`,
    "",
    `Found **${result.results.length}** relevant files:`,
    "",
  ];

  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i]!;
    const rank = i + 1;
    const bar = "█".repeat(Math.ceil(Math.min(r.score, 50) / 5));
    lines.push(`### ${rank}. \`${r.path}\``);
    lines.push(`Score: ${r.score} ${bar}`);
    if (r.reasons.length > 0) {
      lines.push(`Reasons: ${r.reasons.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("### Token Savings");
  lines.push(`Indexed: **${result.tokens.original}** → Returned: **${result.tokens.optimized}** (saved **${result.tokens.savedPercent}%**)`);

  return lines.join("\n");
}
