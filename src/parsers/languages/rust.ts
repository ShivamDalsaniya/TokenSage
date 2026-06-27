/**
 * Tree-sitter extractor for Rust.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractRust(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "line_comment":
      case "block_comment": {
        if (topLevelComments.length === 0) {
          const text = node.text.replace(/^\/\/[!/]?\s*|^\/\*+\s*|\s*\*+\/$/g, "").trim();
          if (text.length > 5) topLevelComments.push(text);
        }
        break;
      }
      case "use_declaration": {
        const imps = extractUseDeclaration(node);
        imports.push(...imps);
        break;
      }
      case "function_item": {
        const sym = extractRustFn(node, source);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "struct_item": {
        const sym = extractRustNamed(node, "struct");
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "enum_item": {
        const sym = extractRustNamed(node, "enum");
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "trait_item": {
        const sym = extractRustNamed(node, "trait");
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "type_item": {
        const sym = extractRustNamed(node, "type");
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "impl_item": {
        // Extract methods from impl blocks
        const body = node.childForFieldName("body") ?? findChild(node, "declaration_list");
        if (!body) break;
        for (const member of body.namedChildren) {
          if (member.type === "function_item") {
            const sym = extractRustFn(member, source);
            if (sym) {
              sym.kind = "method";
              symbols.push(sym);
              if (sym.exported) exports.push(sym.name);
            }
          }
        }
        break;
      }
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function isPub(node: SyntaxNode): boolean {
  return node.children.some((c) => c.type === "visibility_modifier" && c.text.startsWith("pub"));
}

function extractRustFn(node: SyntaxNode, source: string): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
  if (!nameNode) return null;
  const exported = isPub(node);
  const isAsync = node.children.some((c) => c.type === "async");
  return {
    name: nameNode.text,
    kind: "function",
    signature: buildRustSignature(node, source),
    exported,
    async: isAsync,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractRustNamed(node: SyntaxNode, kind: CodeSymbol["kind"]): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["type_identifier", "identifier"]);
  if (!nameNode) return null;
  return {
    name: nameNode.text,
    kind,
    exported: isPub(node),
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function buildRustSignature(node: SyntaxNode, source: string): string {
  const body = node.childForFieldName("body") ?? findChild(node, "block");
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).trim().replace(/\s+/g, " ").slice(0, 300);
}

function extractUseDeclaration(node: SyntaxNode): Import[] {
  const results: Import[] = [];
  const useTree = node.namedChildren.find((c) => c.type !== "visibility_modifier");
  if (!useTree) return results;
  collectUseTree(useTree, "", results);
  return results;
}

function collectUseTree(node: SyntaxNode, prefix: string, results: Import[]): void {
  switch (node.type) {
    case "scoped_identifier": {
      // e.g. std::io
      const path = node.text;
      results.push({ source: path, specifiers: [path.split("::").pop() ?? path] });
      break;
    }
    case "use_as_clause": {
      const path = node.namedChildren[0]?.text ?? "";
      const alias = node.namedChildren[1]?.text ?? "";
      results.push({ source: prefix + path, specifiers: [alias || path] });
      break;
    }
    case "use_list": {
      // { A, B, C }
      for (const child of node.namedChildren) {
        collectUseTree(child, prefix, results);
      }
      break;
    }
    case "use_wildcard": {
      results.push({ source: prefix.replace(/::$/, ""), specifiers: ["*"] });
      break;
    }
    case "scoped_use_list": {
      // std::{ io, fs }
      const scopeNode = node.childForFieldName("path") ?? node.namedChildren[0];
      const listNode = node.childForFieldName("list") ?? node.namedChildren[1];
      const newPrefix = scopeNode ? scopeNode.text + "::" : prefix;
      if (listNode) collectUseTree(listNode, newPrefix, results);
      break;
    }
    case "identifier": {
      results.push({ source: prefix + node.text, specifiers: [node.text] });
      break;
    }
    default: {
      // Fallback: just use the text
      const text = node.text.replace(/^use\s+/, "").replace(/;$/, "").trim();
      if (text) results.push({ source: text, specifiers: [text.split("::").pop() ?? text] });
    }
  }
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}

function findChildByTypes(node: SyntaxNode, types: string[]): SyntaxNode | null {
  return node.children.find((c) => types.includes(c.type)) ?? null;
}
