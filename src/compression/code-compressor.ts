import { readFile } from "node:fs/promises";
import { parseCode, detectLanguage, inferPurpose } from "../parsers/code-parser.js";
import { calculateSavings } from "../analytics/token-counter.js";
import type { CompressedFile } from "../types/index.js";

/**
 * Compress a source file to its structural skeleton.
 */
export async function compressFile(filePath: string): Promise<CompressedFile> {
  const content = await readFile(filePath, "utf-8");
  return compressContent(content, filePath);
}

/**
 * Compress source code content (useful when content is already loaded).
 */
export function compressContent(content: string, filePath: string): CompressedFile {
  const language = detectLanguage(filePath);
  const parsed = parseCode(content, language);

  const purpose = inferPurpose(filePath, parsed.symbols, parsed.imports, parsed.topLevelComments);

  // Build deduplicated dependency list from import sources
  const dependencies = [...new Set(parsed.imports.map((i) => i.source))];

  // Build human-readable summary
  const summary = buildSummary(filePath, language, parsed.symbols, parsed.imports, parsed.exports);

  // Calculate tokens: original = full source, optimized = compressed representation
  const compressed = buildCompressedText(purpose, parsed.imports, parsed.exports, parsed.symbols, dependencies, summary);
  const tokens = calculateSavings(content, compressed);

  return {
    path: filePath,
    language,
    purpose,
    imports: parsed.imports,
    exports: parsed.exports,
    symbols: parsed.symbols,
    dependencies,
    summary,
    tokens,
  };
}

function buildSummary(
  filePath: string,
  language: string,
  symbols: CompressedFile["symbols"],
  imports: CompressedFile["imports"],
  exports: string[]
): string {
  const parts: string[] = [];

  const fileName = filePath.split("/").pop() ?? filePath;
  parts.push(`${fileName} (${language})`);

  if (symbols.length > 0) {
    const byKind: Record<string, string[]> = {};
    for (const s of symbols) {
      byKind[s.kind] = byKind[s.kind] ?? [];
      (byKind[s.kind] as string[]).push(s.name);
    }
    const kindSummary = Object.entries(byKind)
      .map(([kind, names]) => `${names.length} ${kind}${names.length !== 1 ? "s" : ""}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}`)
      .join("; ");
    parts.push(`Defines: ${kindSummary}`);
  }

  if (exports.length > 0) {
    parts.push(`Exports: ${exports.slice(0, 8).join(", ")}${exports.length > 8 ? `… (+${exports.length - 8} more)` : ""}`);
  }

  const externalDeps = imports.filter((i) => !i.source.startsWith(".") && !i.source.startsWith("/"));
  if (externalDeps.length > 0) {
    parts.push(`Uses: ${externalDeps.map((i) => i.source).slice(0, 5).join(", ")}`);
  }

  return parts.join(". ");
}

function buildCompressedText(
  purpose: string,
  imports: CompressedFile["imports"],
  exports: string[],
  symbols: CompressedFile["symbols"],
  dependencies: string[],
  summary: string
): string {
  const lines: string[] = [
    `Purpose: ${purpose}`,
    `Summary: ${summary}`,
    `Imports: ${imports.map((i) => `${i.source}[${i.specifiers.join(",")}]`).join(" | ")}`,
    `Exports: ${exports.join(", ")}`,
    `Symbols: ${symbols.map((s) => `${s.exported ? "+" : "-"}${s.kind}:${s.name}`).join(" ")}`,
    `Deps: ${dependencies.join(", ")}`,
  ];
  return lines.join("\n");
}
