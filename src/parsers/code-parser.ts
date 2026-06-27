/**
 * Code parser that extracts structural information from source files.
 * Primary path: Tree-sitter AST-based parsing (higher accuracy).
 * Fallback: regex-based parsing (no native dependencies).
 * Supports: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Swift, Ruby, PHP, C, C++
 */
import type { ParsedCode, Import, CodeSymbol, SupportedLanguage } from "../types/index.js";
import { isTreeSitterAvailable, parseWithTreeSitter } from "./tree-sitter-parser.js";

export function detectLanguage(filePath: string): SupportedLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, SupportedLanguage> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    pyi: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    rb: "ruby",
    php: "php",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
  };
  return map[ext] ?? "unknown";
}

// ── TypeScript / JavaScript ─────────────────────────────────────────────────

function parseTsJs(content: string): Omit<ParsedCode, "language"> {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];
  let hasDefaultExport = false;

  const lines = content.split("\n");

  // Top-level JSDoc/block comments
  const firstComment = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (firstComment?.[1]) {
    const cleaned = firstComment[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
    if (cleaned) topLevelComments.push(cleaned);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";

    // imports: import X from 'y' / import { a, b } from 'y' / import type ...
    const staticImport = line.match(
      /^import\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]*)\}|(\w+)))?\s+from\s+['"]([^'"]+)['"]/
    );
    if (staticImport) {
      const source = staticImport[6] ?? "";
      const specifiers: string[] = [];
      [staticImport[1], staticImport[4]].forEach((g) => {
        if (g) specifiers.push(...g.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? "").filter(Boolean));
      });
      if (staticImport[2]) specifiers.push(staticImport[2]);
      if (staticImport[3]) specifiers.push(`* as ${staticImport[3]}`);
      imports.push({ source, specifiers, isDefault: !!staticImport[2] });
      continue;
    }

    // side-effect imports
    const sideEffect = line.match(/^import\s+['"]([^'"]+)['"]/);
    if (sideEffect) {
      imports.push({ source: sideEffect[1] ?? "", specifiers: [], isSideEffect: true });
      continue;
    }

    // require
    const req = line.match(/(?:const|let|var)\s+\{?([^}=]+)\}?\s*=\s*require\(['"]([^'"]+)['"]\)/);
    if (req) {
      const source = req[2] ?? "";
      const specifiers = (req[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      imports.push({ source, specifiers });
    }

    // export default
    if (line.match(/^export\s+default\s/)) {
      hasDefaultExport = true;
      exports.push("default");
    }

    // export { a, b, c }
    const namedExport = line.match(/^export\s+\{([^}]+)\}/);
    if (namedExport) {
      exports.push(...(namedExport[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/)[1]?.trim() ?? s.trim()).filter(Boolean));
    }

    // function / async function
    const fnMatch = line.match(
      /^(export\s+)?(export\s+default\s+)?(async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/
    );
    if (fnMatch) {
      symbols.push({
        name: fnMatch[4] ?? "",
        kind: "function",
        signature: line.replace(/\s*\{.*$/, "").trim(),
        exported: !!fnMatch[1] || !!fnMatch[2],
        async: !!fnMatch[3],
        lineStart: i + 1,
      });
      if (fnMatch[1] || fnMatch[2]) exports.push(fnMatch[4] ?? "");
    }

    // class
    const classMatch = line.match(/^(export\s+)?(export\s+default\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      symbols.push({
        name: classMatch[3] ?? "",
        kind: "class",
        signature: line.replace(/\s*\{.*$/, "").trim(),
        exported: !!classMatch[1] || !!classMatch[2],
        lineStart: i + 1,
      });
      if (classMatch[1] || classMatch[2]) exports.push(classMatch[3] ?? "");
    }

    // interface
    const iface = line.match(/^(export\s+)?interface\s+(\w+)/);
    if (iface) {
      symbols.push({ name: iface[2] ?? "", kind: "interface", exported: !!iface[1], lineStart: i + 1 });
      if (iface[1]) exports.push(iface[2] ?? "");
    }

    // type alias
    const typeAlias = line.match(/^(export\s+)?type\s+(\w+)\s*(?:<[^>]*)?\s*=/);
    if (typeAlias) {
      symbols.push({ name: typeAlias[2] ?? "", kind: "type", exported: !!typeAlias[1], lineStart: i + 1 });
      if (typeAlias[1]) exports.push(typeAlias[2] ?? "");
    }

    // const arrow fn / export const
    const constFn = line.match(/^(export\s+)?const\s+(\w+)\s*(?::[^=]+)?\s*=\s*(?:async\s+)?\(/);
    if (constFn) {
      symbols.push({
        name: constFn[2] ?? "",
        kind: "function",
        exported: !!constFn[1],
        async: line.includes("async "),
        lineStart: i + 1,
      });
      if (constFn[1]) exports.push(constFn[2] ?? "");
    }

    // enum
    const enumMatch = line.match(/^(export\s+)?(?:const\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      symbols.push({ name: enumMatch[2] ?? "", kind: "enum", exported: !!enumMatch[1], lineStart: i + 1 });
      if (enumMatch[1]) exports.push(enumMatch[2] ?? "");
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport };
}

// ── Python ───────────────────────────────────────────────────────────────────

function parsePython(content: string): Omit<ParsedCode, "language"> {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  const lines = content.split("\n");

  // Module docstring
  const docMatch = content.match(/^(?:[']{3}|["]{3})([\s\S]*?)(?:[']{3}|["]{3})/);
  if (docMatch?.[1]) topLevelComments.push(docMatch[1].trim().split("\n")[0]?.trim() ?? "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";

    const fromImport = line.match(/^from\s+([\w.]+)\s+import\s+(.*)/);
    if (fromImport) {
      const source = fromImport[1] ?? "";
      const raw = fromImport[2] ?? "";
      const specifiers = raw === "*" ? ["*"] : raw.replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? "").filter(Boolean);
      imports.push({ source, specifiers });
      continue;
    }

    const plainImport = line.match(/^import\s+([\w.,\s]+)/);
    if (plainImport) {
      const parts = (plainImport[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? "");
      for (const p of parts) {
        if (p) imports.push({ source: p, specifiers: [p] });
      }
      continue;
    }

    const fnMatch = line.match(/^(?:async\s+)?def\s+(\w+)\s*\((.*)\)/);
    if (fnMatch) {
      const exported = !fnMatch[1]?.startsWith("_");
      symbols.push({ name: fnMatch[1] ?? "", kind: "function", exported, async: line.startsWith("async"), lineStart: i + 1 });
      if (exported) exports.push(fnMatch[1] ?? "");
    }

    const classMatch = line.match(/^class\s+(\w+)/);
    if (classMatch) {
      symbols.push({ name: classMatch[1] ?? "", kind: "class", exported: true, lineStart: i + 1 });
      exports.push(classMatch[1] ?? "");
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

// ── Generic fallback ─────────────────────────────────────────────────────────

function parseGeneric(content: string, language: SupportedLanguage): Omit<ParsedCode, "language"> {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";

    // Go imports
    if (language === "go") {
      const single = line.match(/^import\s+"([^"]+)"/);
      if (single) imports.push({ source: single[1] ?? "", specifiers: [] });

      const fnMatch = line.match(/^func\s+(\w+)/);
      if (fnMatch) {
        const name = fnMatch[1] ?? "";
        const exported = /^[A-Z]/.test(name);
        symbols.push({ name, kind: "function", exported, lineStart: i + 1 });
        if (exported) exports.push(name);
      }
    }

    // Rust
    if (language === "rust") {
      const useMatch = line.match(/^use\s+([\w:]+)/);
      if (useMatch) imports.push({ source: useMatch[1] ?? "", specifiers: [] });

      const fnMatch = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
      if (fnMatch) {
        const exported = line.startsWith("pub ");
        symbols.push({ name: fnMatch[1] ?? "", kind: "function", exported, lineStart: i + 1 });
        if (exported) exports.push(fnMatch[1] ?? "");
      }
    }
  }

  return { imports, exports, symbols, topLevelComments, hasDefaultExport: false };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function parseCode(content: string, language: SupportedLanguage): ParsedCode {
  // Try Tree-sitter first — higher accuracy, richer metadata
  if (isTreeSitterAvailable()) {
    try {
      const tsResult = parseWithTreeSitter(content, language);
      if (tsResult !== null) return { ...tsResult, language };
    } catch {
      // Silent fallback to regex
    }
  }

  // Regex fallback
  let parsed: Omit<ParsedCode, "language">;
  switch (language) {
    case "typescript":
    case "javascript":
      parsed = parseTsJs(content);
      break;
    case "python":
      parsed = parsePython(content);
      break;
    default:
      parsed = parseGeneric(content, language);
  }

  return { ...parsed, language };
}

export function inferPurpose(
  filePath: string,
  symbols: CodeSymbol[],
  imports: Import[],
  topLevelComments: string[]
): string {
  if (topLevelComments.length > 0) {
    const comment = topLevelComments[0] ?? "";
    if (comment.length > 10 && comment.length < 200) return comment;
  }

  const fileName = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const lowerName = fileName.toLowerCase();

  const patterns: Array<[RegExp, string]> = [
    [/index|main|app/, "Application entry point"],
    [/server|api/, "HTTP server / API handler"],
    [/router|routes?/, "Routing definitions"],
    [/controller/, "Request controller"],
    [/service/, "Business logic service"],
    [/model|schema/, "Data model / schema definition"],
    [/util|helper|lib/, "Utility functions"],
    [/config|settings?/, "Configuration"],
    [/test|spec|__tests__/, "Test suite"],
    [/type|interface/, "Type definitions"],
    [/hook/, "React hook / lifecycle hook"],
    [/component/, "UI component"],
    [/store|redux|slice/, "State management"],
    [/middleware/, "Middleware"],
    [/auth/, "Authentication / authorization"],
    [/db|database|migration/, "Database operations"],
    [/parse|parser/, "Parser / code analysis"],
    [/compress|optim/, "Compression / optimization"],
    [/analytics|track/, "Analytics / tracking"],
  ];

  for (const [pattern, label] of patterns) {
    if (pattern.test(lowerName)) return label;
  }

  const classNames = symbols.filter((s) => s.kind === "class").map((s) => s.name);
  if (classNames.length === 1) return `${classNames[0]} class implementation`;
  if (classNames.length > 1) return `${classNames.join(", ")} class implementations`;

  const fnCount = symbols.filter((s) => s.kind === "function").length;
  if (fnCount > 0) return `Module with ${fnCount} exported function${fnCount === 1 ? "" : "s"}`;

  const importSources = imports.slice(0, 3).map((i) => i.source.split("/").pop());
  if (importSources.length > 0) return `Module using ${importSources.join(", ")}`;

  return "Source module";
}
