/**
 * Tree-sitter extractor for TypeScript and JavaScript.
 * Handles both TS and JS since the TypeScript grammar is a superset.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractTypeScript(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];
  let hasDefaultExport = false;

  // Collect exported names from export_statement wrappers for symbol tagging
  const exportedNames = new Set<string>();

  // First pass: collect export names from export_clause and export_statement wrappers
  for (const node of root.children) {
    if (node.type === "export_statement") {
      processExportStatement(node, source, exports, exportedNames, symbols, () => { hasDefaultExport = true; });
    }
  }

  // Second pass: walk root children
  let commentSectionDone = false;
  for (const node of root.children) {
    switch (node.type) {
      case "comment": {
        if (!commentSectionDone && topLevelComments.length === 0) {
          const text = node.text;
          if (text.startsWith("/**") || text.startsWith("/*")) {
            const cleaned = text
              .replace(/^\/\*+\s*/, "")
              .replace(/\s*\*+\/$/, "")
              .split("\n")
              .map((l) => l.replace(/^\s*\*\s?/, "").trim())
              .filter(Boolean)
              .join(" ");
            if (cleaned.length > 5) topLevelComments.push(cleaned);
          } else if (text.startsWith("//")) {
            const cleaned = text.replace(/^\/\/\s*/, "").trim();
            if (cleaned.length > 5) topLevelComments.push(cleaned);
          }
        }
        break;
      }
      case "import_statement": {
        commentSectionDone = true;
        const imp = extractImport(node);
        if (imp) imports.push(imp);
        break;
      }
      case "export_statement":
        commentSectionDone = true;
        // Already processed in first pass; just extract inner symbols
        extractExportedSymbol(node, source, symbols, exports, exportedNames);
        break;
      case "function_declaration":
      case "generator_function_declaration": {
        commentSectionDone = true;
        const sym = extractFunction(node, source, exportedNames);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "class_declaration":
      case "abstract_class_declaration": {
        commentSectionDone = true;
        const sym = extractClass(node, source, exportedNames, symbols);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "interface_declaration": {
        commentSectionDone = true;
        const sym = extractInterface(node, exportedNames);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "type_alias_declaration": {
        commentSectionDone = true;
        const sym = extractTypeAlias(node, exportedNames);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "enum_declaration": {
        commentSectionDone = true;
        const sym = extractEnum(node, exportedNames);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        commentSectionDone = true;
        const syms = extractVariables(node, source, exportedNames);
        for (const sym of syms) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "ambient_declaration": {
        commentSectionDone = true;
        const inner = node.namedChildren[0];
        if (inner) {
          const sym = extractAmbient(inner, exportedNames);
          if (sym) symbols.push(sym);
        }
        break;
      }
      default:
        if (node.isNamed) commentSectionDone = true;
    }
  }

  return {
    imports,
    exports: [...new Set(exports)],
    symbols,
    topLevelComments,
    hasDefaultExport,
  };
}

// ── Import extraction ─────────────────────────────────────────────────────

function extractImport(node: SyntaxNode): Import | null {
  // Find source string
  const sourceNode = findChild(node, "string");
  if (!sourceNode) return null;
  const src = stripQuotes(sourceNode.text);

  // Side-effect import: import 'mod'
  const clause = findChild(node, "import_clause");
  if (!clause) {
    return { source: src, specifiers: [], isSideEffect: true };
  }

  const specifiers: string[] = [];
  let isDefault = false;

  for (const child of clause.namedChildren) {
    switch (child.type) {
      case "identifier":
        // default import
        specifiers.push(child.text);
        isDefault = true;
        break;
      case "namespace_import": {
        // import * as ns
        const id = child.namedChildren.find((c) => c.type === "identifier");
        if (id) specifiers.push(`* as ${id.text}`);
        break;
      }
      case "named_imports": {
        // import { a, b as c }
        for (const spec of child.namedChildren) {
          if (spec.type === "import_specifier") {
            // first identifier is the local/original name
            const names = spec.namedChildren.filter((c) => c.type === "identifier");
            if (names[0]) specifiers.push(names[0].text);
          }
        }
        break;
      }
    }
  }

  return { source: src, specifiers, isDefault };
}

// ── Export statement processing ───────────────────────────────────────────

function processExportStatement(
  node: SyntaxNode,
  source: string,
  exports: string[],
  exportedNames: Set<string>,
  symbols: CodeSymbol[],
  onDefault: () => void
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "default":
        onDefault();
        exports.push("default");
        break;
      case "export_clause": {
        // export { a, b as c }
        for (const spec of child.namedChildren) {
          if (spec.type === "export_specifier") {
            const names = spec.namedChildren.filter((c) => c.type === "identifier");
            // Last identifier is the exported name (the 'as' alias if present)
            const exportedName = names[names.length - 1]?.text;
            if (exportedName) {
              exports.push(exportedName);
              exportedNames.add(exportedName);
            }
          }
        }
        break;
      }
      // declared symbols: mark them as exported
      case "function_declaration":
      case "generator_function_declaration":
      case "class_declaration":
      case "abstract_class_declaration":
      case "interface_declaration":
      case "type_alias_declaration":
      case "enum_declaration":
      case "lexical_declaration":
      case "variable_declaration": {
        const name = getDeclaredName(child);
        if (name) exportedNames.add(name);
        break;
      }
    }
  }
}

function extractExportedSymbol(
  exportNode: SyntaxNode,
  source: string,
  symbols: CodeSymbol[],
  exports: string[],
  exportedNames: Set<string>
): void {
  let isDefault = false;
  for (const child of exportNode.children) {
    if (child.type === "default") isDefault = true;
  }

  for (const child of exportNode.namedChildren) {
    switch (child.type) {
      case "function_declaration":
      case "generator_function_declaration": {
        const sym = extractFunction(child, source, exportedNames);
        if (sym) {
          sym.exported = true;
          if (isDefault) sym.name = sym.name || "default";
          symbols.push(sym);
          if (sym.name) exports.push(sym.name);
        }
        break;
      }
      case "class_declaration":
      case "abstract_class_declaration": {
        const sym = extractClass(child, source, exportedNames, symbols);
        if (sym) {
          sym.exported = true;
          symbols.push(sym);
          if (sym.name) exports.push(sym.name);
        }
        break;
      }
      case "interface_declaration": {
        const sym = extractInterface(child, exportedNames);
        if (sym) {
          sym.exported = true;
          symbols.push(sym);
          if (sym.name) exports.push(sym.name);
        }
        break;
      }
      case "type_alias_declaration": {
        const sym = extractTypeAlias(child, exportedNames);
        if (sym) {
          sym.exported = true;
          symbols.push(sym);
          if (sym.name) exports.push(sym.name);
        }
        break;
      }
      case "enum_declaration": {
        const sym = extractEnum(child, exportedNames);
        if (sym) {
          sym.exported = true;
          symbols.push(sym);
          if (sym.name) exports.push(sym.name);
        }
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        const syms = extractVariables(child, source, exportedNames);
        for (const sym of syms) {
          sym.exported = true;
          symbols.push(sym);
          if (sym.name) exports.push(sym.name);
        }
        break;
      }
    }
  }
}

// ── Symbol extraction helpers ─────────────────────────────────────────────

function extractFunction(
  node: SyntaxNode,
  source: string,
  exportedNames: Set<string>
): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
  if (!nameNode) return null;
  const name = nameNode.text;

  const isAsync = node.children.some((c) => c.type === "async");
  const exported = exportedNames.has(name) || node.parent?.type === "export_statement";

  return {
    name,
    kind: "function",
    signature: buildSignature(node, source),
    exported,
    async: isAsync,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractClass(
  node: SyntaxNode,
  source: string,
  exportedNames: Set<string>,
  symbols: CodeSymbol[]
): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["type_identifier", "identifier"]);
  if (!nameNode) return null;
  const name = nameNode.text;
  const exported = exportedNames.has(name) || node.parent?.type === "export_statement";

  // Extract public methods from class body
  const body = node.childForFieldName("body");
  if (body) {
    for (const member of body.namedChildren) {
      if (member.type === "method_definition" || member.type === "public_field_definition") {
        const methodName = member.childForFieldName("name") ?? findChildByTypes(member, ["property_identifier", "identifier"]);
        if (!methodName) continue;
        // Skip private/protected
        const hasPrivate = member.children.some((c) => c.type === "accessibility_modifier" && (c.text === "private" || c.text === "protected"));
        if (hasPrivate) continue;
        const isAsync = member.children.some((c) => c.type === "async");
        symbols.push({
          name: methodName.text,
          kind: "method",
          signature: buildSignature(member, source),
          exported: false,
          async: isAsync,
          lineStart: member.startPosition.row + 1,
          lineEnd: member.endPosition.row + 1,
        });
      }
    }
  }

  return {
    name,
    kind: "class",
    signature: buildSignature(node, source),
    exported,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractInterface(node: SyntaxNode, exportedNames: Set<string>): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["type_identifier", "identifier"]);
  if (!nameNode) return null;
  const name = nameNode.text;
  return {
    name,
    kind: "interface",
    exported: exportedNames.has(name) || node.parent?.type === "export_statement",
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractTypeAlias(node: SyntaxNode, exportedNames: Set<string>): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["type_identifier", "identifier"]);
  if (!nameNode) return null;
  const name = nameNode.text;
  return {
    name,
    kind: "type",
    exported: exportedNames.has(name) || node.parent?.type === "export_statement",
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractEnum(node: SyntaxNode, exportedNames: Set<string>): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
  if (!nameNode) return null;
  const name = nameNode.text;
  return {
    name,
    kind: "enum",
    exported: exportedNames.has(name) || node.parent?.type === "export_statement",
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractVariables(
  node: SyntaxNode,
  source: string,
  exportedNames: Set<string>
): CodeSymbol[] {
  const results: CodeSymbol[] = [];
  const isConst = node.children.some((c) => c.text === "const");

  for (const decl of node.namedChildren) {
    if (decl.type !== "variable_declarator") continue;
    const nameNode = decl.childForFieldName("name") ?? findChildByTypes(decl, ["identifier", "array_pattern", "object_pattern"]);
    if (!nameNode || nameNode.type !== "identifier") continue;
    const name = nameNode.text;

    const value = decl.childForFieldName("value");
    let kind: CodeSymbol["kind"] = isConst ? "constant" : "variable";
    let isAsync = false;

    if (value) {
      if (value.type === "arrow_function" || value.type === "function") {
        kind = "function";
        isAsync = value.children.some((c) => c.type === "async");
      } else if (value.type === "async") {
        kind = "function";
        isAsync = true;
      }
    }

    const exported = exportedNames.has(name) || node.parent?.type === "export_statement";

    results.push({
      name,
      kind,
      signature: kind === "function" ? buildArrowSignature(decl, source) : undefined,
      exported,
      async: isAsync || undefined,
      lineStart: decl.startPosition.row + 1,
      lineEnd: decl.endPosition.row + 1,
    });
  }

  return results;
}

function extractAmbient(node: SyntaxNode, exportedNames: Set<string>): CodeSymbol | null {
  switch (node.type) {
    case "function_declaration": {
      const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
      if (!nameNode) return null;
      return {
        name: nameNode.text,
        kind: "function",
        exported: exportedNames.has(nameNode.text),
        lineStart: node.startPosition.row + 1,
      };
    }
    case "class_declaration":
    case "abstract_class_declaration": {
      const nameNode = findChildByTypes(node, ["type_identifier", "identifier"]);
      if (!nameNode) return null;
      return {
        name: nameNode.text,
        kind: "class",
        exported: exportedNames.has(nameNode.text),
        lineStart: node.startPosition.row + 1,
      };
    }
    default:
      return null;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function getDeclaredName(node: SyntaxNode): string | null {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const n = node.childForFieldName("name") ?? findChild(node, "identifier");
      return n?.text ?? null;
    }
    case "class_declaration":
    case "abstract_class_declaration":
    case "interface_declaration":
    case "type_alias_declaration":
    case "enum_declaration": {
      const n = findChildByTypes(node, ["type_identifier", "identifier"]);
      return n?.text ?? null;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      const decl = node.namedChildren.find((c) => c.type === "variable_declarator");
      if (!decl) return null;
      const n = decl.childForFieldName("name") ?? findChild(decl, "identifier");
      return n?.text ?? null;
    }
    default:
      return null;
  }
}

function buildSignature(node: SyntaxNode, source: string): string {
  // Find the body to truncate at it
  const body = node.childForFieldName("body") ?? findChild(node, "statement_block") ?? findChild(node, "class_body");
  const end = body ? body.startIndex : node.endIndex;
  const sig = source.slice(node.startIndex, end).trim().replace(/\s+/g, " ").replace(/\s*\{$/, "").trim();
  // Cap length to avoid massive signatures
  return sig.length > 300 ? sig.slice(0, 297) + "..." : sig;
}

function buildArrowSignature(declarator: SyntaxNode, source: string): string {
  const value = declarator.childForFieldName("value");
  if (!value) return declarator.text.split("{")[0]?.trim() ?? "";
  // For arrow function: include everything up to (but not including) the body
  const body = value.childForFieldName("body");
  const end = body?.type === "statement_block" ? body.startIndex : value.endIndex;
  const nameNode = declarator.childForFieldName("name");
  const start = declarator.parent?.startIndex ?? declarator.startIndex;
  const sig = source.slice(start, end).trim().replace(/\s+/g, " ").replace(/=>$/, "=>").trim();
  return sig.length > 300 ? sig.slice(0, 297) + "..." : sig;
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}

function findChildByTypes(node: SyntaxNode, types: string[]): SyntaxNode | null {
  return node.children.find((c) => types.includes(c.type)) ?? null;
}

function stripQuotes(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, "");
}
