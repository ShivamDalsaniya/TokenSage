import { z } from "zod";
import { compressFile, compressContent } from "../compression/code-compressor.js";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { CompressedFile } from "../types/index.js";

export const compressFileSchema = z.object({
  path: z.string().describe("Absolute or relative path to the source file"),
  content: z.string().optional().describe("File content (if already loaded, avoids disk read)"),
});

export type CompressFileInput = z.infer<typeof compressFileSchema>;

export async function handleCompressFile(input: CompressFileInput): Promise<CompressedFile> {
  const result = input.content
    ? compressContent(input.content, input.path)
    : await compressFile(input.path);

  sessionTracker.record("compress_file", result.tokens, input.path.split("/").pop() ?? input.path);
  return result;
}

export function formatCompressFileOutput(result: CompressedFile): string {
  const lines: string[] = [
    `# ${result.path}`,
    `**Language:** ${result.language}`,
    `**Purpose:** ${result.purpose}`,
    "",
    `## Summary`,
    result.summary,
    "",
  ];

  if (result.imports.length > 0) {
    lines.push("## Imports");
    for (const imp of result.imports.slice(0, 20)) {
      const specs = imp.specifiers.length > 0 ? ` { ${imp.specifiers.slice(0, 5).join(", ")}${imp.specifiers.length > 5 ? "…" : ""} }` : "";
      lines.push(`- \`${imp.source}\`${specs}`);
    }
    if (result.imports.length > 20) lines.push(`- … (${result.imports.length - 20} more)`);
    lines.push("");
  }

  if (result.exports.length > 0) {
    lines.push("## Exports");
    lines.push(result.exports.slice(0, 15).map((e) => `\`${e}\``).join(", ") + (result.exports.length > 15 ? ` +${result.exports.length - 15} more` : ""));
    lines.push("");
  }

  if (result.symbols.length > 0) {
    lines.push("## Symbols");
    for (const sym of result.symbols.slice(0, 25)) {
      const prefix = sym.exported ? "+" : "-";
      const asyncMark = sym.async ? "async " : "";
      const sig = sym.signature ?? `${sym.kind} ${sym.name}`;
      lines.push(`- ${prefix} ${asyncMark}**${sym.kind}** \`${sym.name}\`${sym.signature ? `: ${sig}` : ""}`);
    }
    if (result.symbols.length > 25) lines.push(`- … (${result.symbols.length - 25} more symbols)`);
    lines.push("");
  }

  if (result.dependencies.length > 0) {
    lines.push("## Dependencies");
    lines.push(result.dependencies.slice(0, 10).map((d) => `\`${d}\``).join(", "));
    lines.push("");
  }

  lines.push("## Token Savings");
  lines.push(`Original: **${result.tokens.original}** tokens → Optimized: **${result.tokens.optimized}** tokens`);
  lines.push(`Saved: **${result.tokens.saved}** tokens (**${result.tokens.savedPercent}%** reduction)`);

  return lines.join("\n");
}
