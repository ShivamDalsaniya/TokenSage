import { z } from "zod";
import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { detectLanguage, parseCode } from "../parsers/code-parser.js";
import { calculateSavings } from "../analytics/token-counter.js";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { CompressedDirectory } from "../types/index.js";

export const compressDirectorySchema = z.object({
  path: z.string().describe("Absolute or relative path to directory"),
  maxFiles: z.number().int().min(1).max(500).default(100).describe("Maximum files to analyze"),
  includeTests: z.boolean().default(false).describe("Include test files in analysis"),
});

export type CompressDirectoryInput = z.infer<typeof compressDirectorySchema>;

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", ".cache", "__pycache__", ".pytest_cache", "vendor",
  ".turbo", ".parcel-cache",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".kt", ".swift",
  ".rb", ".php", ".cpp", ".cc", ".c", ".h",
]);

const TEST_PATTERNS = /\.(test|spec)\.|__tests__|_test\.|tests\//;

async function collectFiles(
  dir: string,
  baseDir: string,
  maxFiles: number,
  includeTests: boolean,
  collected: string[] = []
): Promise<string[]> {
  if (collected.length >= maxFiles) return collected;

  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    if (collected.length >= maxFiles) break;
    const entryName = entry.name;

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entryName) || entryName.startsWith(".")) continue;
      await collectFiles(join(dir, entryName), baseDir, maxFiles, includeTests, collected);
    } else if (entry.isFile()) {
      const ext = extname(entryName);
      if (!CODE_EXTENSIONS.has(ext)) continue;
      const fullPath = join(dir, entryName);
      if (!includeTests && TEST_PATTERNS.test(fullPath)) continue;
      collected.push(fullPath);
    }
  }

  return collected;
}

interface FileMeta {
  path: string;
  relPath: string;
  language: string;
  imports: string[];
  exports: string[];
  size: number;
}

async function analyzeFile(filePath: string, baseDir: string): Promise<FileMeta | null> {
  try {
    const stats = await stat(filePath);
    if (stats.size > 200 * 1024) return null; // skip very large files

    const content = await readFile(filePath, "utf-8");
    const language = detectLanguage(filePath);
    const parsed = parseCode(content, language);

    return {
      path: filePath,
      relPath: relative(baseDir, filePath),
      language,
      imports: parsed.imports.map((i) => i.source),
      exports: parsed.exports,
      size: stats.size,
    };
  } catch {
    return null;
  }
}

function detectTechStack(files: FileMeta[]): string[] {
  const stack = new Set<string>();
  const langCount: Record<string, number> = {};

  for (const f of files) {
    langCount[f.language] = (langCount[f.language] ?? 0) + 1;

    for (const imp of f.imports) {
      if (imp.startsWith("react")) stack.add("React");
      else if (imp.startsWith("next")) stack.add("Next.js");
      else if (imp.startsWith("vue")) stack.add("Vue");
      else if (imp.startsWith("express")) stack.add("Express");
      else if (imp.startsWith("fastify")) stack.add("Fastify");
      else if (imp.startsWith("@nestjs")) stack.add("NestJS");
      else if (imp.startsWith("prisma") || imp.startsWith("@prisma")) stack.add("Prisma");
      else if (imp.startsWith("typeorm")) stack.add("TypeORM");
      else if (imp.startsWith("mongoose")) stack.add("Mongoose");
      else if (imp.startsWith("zod")) stack.add("Zod");
      else if (imp.startsWith("@modelcontextprotocol")) stack.add("MCP");
      else if (imp.startsWith("vitest") || imp.startsWith("jest")) stack.add("Testing");
    }
  }

  // Add primary languages
  const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]);
  for (const [lang] of sorted.slice(0, 3)) {
    if (lang !== "unknown") stack.add(lang.charAt(0).toUpperCase() + lang.slice(1));
  }

  return [...stack];
}

function buildDependencyGraph(files: FileMeta[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  const relPathSet = new Set(files.map((f) => f.relPath));

  for (const file of files) {
    const deps: string[] = [];
    for (const imp of file.imports) {
      if (imp.startsWith(".")) {
        // Relative import — try to resolve
        const resolved = relative(".", join(file.relPath, "..", imp));
        const match = files.find(
          (f) =>
            f.relPath === resolved ||
            f.relPath === `${resolved}.ts` ||
            f.relPath === `${resolved}.js` ||
            f.relPath === `${resolved}/index.ts`
        );
        if (match) deps.push(match.relPath);
      }
    }
    if (deps.length > 0) graph[file.relPath] = deps;
  }

  void relPathSet; // used indirectly
  return graph;
}

function findImportantFiles(files: FileMeta[]): Array<{ path: string; reason: string }> {
  const important: Array<{ path: string; reason: string }> = [];
  const seen = new Set<string>();

  const add = (path: string, reason: string) => {
    if (!seen.has(path)) {
      seen.add(path);
      important.push({ path, reason });
    }
  };

  for (const f of files) {
    const lower = f.relPath.toLowerCase();
    if (/^(src\/)?index\.(ts|js)$/.test(lower)) add(f.relPath, "Entry point");
    else if (/^(src\/)?main\.(ts|js)$/.test(lower)) add(f.relPath, "Main entry");
    else if (/^(src\/)?app\.(ts|js|tsx)$/.test(lower)) add(f.relPath, "App root");
    else if (/server\/index\.(ts|js)$/.test(lower)) add(f.relPath, "Server entry");
    else if (/config\.(ts|js)$/.test(lower)) add(f.relPath, "Configuration");
    else if (/types\/index\.(ts|js)$/.test(lower)) add(f.relPath, "Type definitions");
    else if (f.exports.length > 5) add(f.relPath, `High export count (${f.exports.length} exports)`);
  }

  // Find most-imported files
  const importCounts: Record<string, number> = {};
  for (const f of files) {
    for (const imp of f.imports) {
      if (imp.startsWith(".")) importCounts[imp] = (importCounts[imp] ?? 0) + 1;
    }
  }

  return important.slice(0, 15);
}

function buildArchitectureSummary(
  baseDir: string,
  files: FileMeta[],
  techStack: string[],
  entryPoints: string[]
): string {
  const dirStructure: Record<string, number> = {};
  for (const f of files) {
    const dir = f.relPath.split("/")[0] ?? ".";
    dirStructure[dir] = (dirStructure[dir] ?? 0) + 1;
  }

  const dirSummary = Object.entries(dirStructure)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([dir, count]) => `${dir}/ (${count} files)`)
    .join(", ");

  const parts = [
    `Directory: ${baseDir}`,
    `Files analyzed: ${files.length}`,
    `Tech stack: ${techStack.join(", ") || "Unknown"}`,
    `Structure: ${dirSummary}`,
    entryPoints.length > 0 ? `Entry points: ${entryPoints.join(", ")}` : "",
  ].filter(Boolean);

  return parts.join(". ");
}

export async function handleCompressDirectory(input: CompressDirectoryInput): Promise<CompressedDirectory> {
  const files = await collectFiles(input.path, input.path, input.maxFiles, input.includeTests);

  const metas = (await Promise.all(files.map((f) => analyzeFile(f, input.path)))).filter(
    (m): m is FileMeta => m !== null
  );

  const techStack = detectTechStack(metas);
  const dependencyGraph = buildDependencyGraph(metas);
  const importantFiles = findImportantFiles(metas);

  const entryPoints = importantFiles
    .filter((f) => f.reason.includes("entry") || f.reason.includes("Entry"))
    .map((f) => f.path);

  const fileRelationships = Object.entries(dependencyGraph)
    .flatMap(([from, deps]) => deps.map((to) => ({ from, to, relationship: "imports" })))
    .slice(0, 50);

  const architecture = buildArchitectureSummary(input.path, metas, techStack, entryPoints);

  // Calculate token savings
  const originalContent = metas
    .map((m) => `// ${m.relPath}\n${m.imports.join("\n")}\n${m.exports.join("\n")}`)
    .join("\n\n");

  const optimizedContent = [architecture, JSON.stringify({ importantFiles, techStack }, null, 0)].join("\n");

  const tokens = calculateSavings(originalContent, optimizedContent);

  sessionTracker.record("compress_directory", tokens);

  return {
    path: input.path,
    architecture,
    entryPoints,
    dependencyGraph,
    fileRelationships,
    importantFiles,
    techStack,
    summary: architecture,
    tokens,
  };
}
