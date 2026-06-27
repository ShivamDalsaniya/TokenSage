/**
 * Tree-sitter based parser.
 * Loads grammars lazily via createRequire (CJS interop from ESM).
 * If tree-sitter or any grammar fails to load, the affected language
 * silently falls back to the regex parser in code-parser.ts.
 */
import { createRequire } from "module";
import type { ParsedCode, SupportedLanguage } from "../types/index.js";
import type { TreeSitterParserConstructor, TreeSitterParser, Tree, ExtractResult, Extractor } from "./tree-sitter-types.js";
import { extractTypeScript } from "./languages/typescript.js";
import { extractPython } from "./languages/python.js";
import { extractGo } from "./languages/go.js";
import { extractRust } from "./languages/rust.js";
import { extractJava } from "./languages/java.js";
import { extractKotlin } from "./languages/kotlin.js";
import { extractSwift } from "./languages/swift.js";
import { extractRuby } from "./languages/ruby.js";
import { extractPhp } from "./languages/php.js";
import { extractCpp } from "./languages/cpp.js";

const require = createRequire(import.meta.url);

// ── Module-level init ─────────────────────────────────────────────────────

let _available = false;
let _ParserClass: TreeSitterParserConstructor | null = null;

// Per-language: loaded grammar object (opaque to us, passed to setLanguage)
const _grammars = new Map<SupportedLanguage, unknown>();

// Per-language: cached Parser instances (one per language)
const _parsers = new Map<SupportedLanguage, TreeSitterParser>();

// Language extractor functions
const _extractors: Partial<Record<SupportedLanguage, Extractor>> = {
  typescript: extractTypeScript,
  javascript: extractTypeScript, // JS is a subset of the TS grammar
  python: extractPython,
  go: extractGo,
  rust: extractRust,
  java: extractJava,
  kotlin: extractKotlin,
  swift: extractSwift,
  ruby: extractRuby,
  php: extractPhp,
  c: extractCpp,
  cpp: extractCpp,
};

// Grammar loading map: language → [npm package, optional sub-key]
type GrammarEntry = [SupportedLanguage[], string, string?];
const GRAMMAR_MAP: GrammarEntry[] = [
  [["typescript", "javascript"], "tree-sitter-typescript", "typescript"],
  [["python"], "tree-sitter-python"],
  [["go"], "tree-sitter-go"],
  [["rust"], "tree-sitter-rust"],
  [["java"], "tree-sitter-java"],
  [["kotlin"], "tree-sitter-kotlin"],
  [["swift"], "tree-sitter-swift"],
  [["ruby"], "tree-sitter-ruby"],
  [["php"], "tree-sitter-php", "php"],
  [["c"], "tree-sitter-c"],
  [["cpp"], "tree-sitter-cpp"],
];

try {
  _ParserClass = require("tree-sitter") as TreeSitterParserConstructor;

  for (const [langs, pkg, subkey] of GRAMMAR_MAP) {
    try {
      const mod = require(pkg) as Record<string, unknown>;
      // Some packages export the grammar directly; others wrap it in a sub-key
      const grammar = subkey ? (mod[subkey] ?? mod) : mod;
      for (const lang of langs) {
        _grammars.set(lang, grammar);
      }
    } catch {
      // Grammar unavailable — those languages fall back to regex
    }
  }

  _available = true;
} catch {
  _available = false;
}

// ── Public API ────────────────────────────────────────────────────────────

export function isTreeSitterAvailable(): boolean {
  return _available;
}

/**
 * Parse content with tree-sitter.
 * Returns null if tree-sitter is unavailable or has no grammar for the language.
 * Throws are suppressed — callers receive null and fall back to regex.
 */
export function parseWithTreeSitter(
  content: string,
  language: SupportedLanguage
): Omit<ParsedCode, "language"> | null {
  if (!_available || !_ParserClass) return null;
  if (!_grammars.has(language)) return null;

  const extractor = _extractors[language];
  if (!extractor) return null;

  try {
    const parser = getOrCreateParser(language);
    const tree = parser.parse(content);
    const result: ExtractResult = extractor(tree.rootNode, content);
    return result;
  } catch {
    return null;
  }
}

function getOrCreateParser(language: SupportedLanguage): TreeSitterParser {
  let parser = _parsers.get(language);
  if (!parser) {
    parser = new _ParserClass!();
    parser.setLanguage(_grammars.get(language));
    _parsers.set(language, parser);
  }
  return parser;
}
