/**
 * Tree-sitter extractor for Swift.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractSwift(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "comment":
      case "multiline_comment": {
        if (topLevelComments.length === 0) {
          const text = node.text.replace(/^\/\/[!\/]?\s*|^\/\*+\s*|\s*\*+\/$/g, "").trim();
          if (text.length > 5) topLevelComments.push(text);
        }
        break;
      }
      case "import_declaration": {
        const path = node.namedChildren.map((c) => c.text).join(".");
        const src = node.text.replace(/^import\s+/, "").trim();
        imports.push({ source: src, specifiers: [src.split(".").pop() ?? src] });
        break;
      }
      case "function_declaration": {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "simple_identifier");
        if (!nameNode) break;
        const exported = isSwiftExported(node);
        const isAsync = node.children.some((c) => c.type === "async");
        symbols.push({
          name: nameNode.text,
          kind: "function",
          signature: buildSwiftSignature(node, source),
          exported,
          async: isAsync,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (exported) exports.push(nameNode.text);
        break;
      }
      case "class_declaration": {
        const sym = extractSwiftType(node, "class");
        if (sym) { symbols.push(sym); if (sym.exported) exports.push(sym.name); }
        break;
      }
      case "struct_declaration": {
        const sym = extractSwiftType(node, "struct");
        if (sym) { symbols.push(sym); if (sym.exported) exports.push(sym.name); }
        break;
      }
      case "protocol_declaration": {
        const sym = extractSwiftType(node, "protocol");
        if (sym) { symbols.push(sym); if (sym.exported) exports.push(sym.name); }
        break;
      }
      case "enum_declaration": {
        const sym = extractSwiftType(node, "enum");
        if (sym) { symbols.push(sym); if (sym.exported) exports.push(sym.name); }
        break;
      }
      case "typealias_declaration": {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "simple_identifier");
        if (!nameNode) break;
        const exported = isSwiftExported(node);
        symbols.push({
          name: nameNode.text,
          kind: "type",
          exported,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (exported) exports.push(nameNode.text);
        break;
      }
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function extractSwiftType(node: SyntaxNode, kind: CodeSymbol["kind"]): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChild(node, "type_identifier") ?? findChild(node, "simple_identifier");
  if (!nameNode) return null;
  const exported = isSwiftExported(node);
  return {
    name: nameNode.text,
    kind,
    exported,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function isSwiftExported(node: SyntaxNode): boolean {
  return node.children.some((c) => c.type === "modifier" && (c.text === "public" || c.text === "open"));
}

function buildSwiftSignature(node: SyntaxNode, source: string): string {
  const body = node.childForFieldName("body") ?? findChild(node, "code_block");
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).trim().replace(/\s+/g, " ").slice(0, 300);
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}
