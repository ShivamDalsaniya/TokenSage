/**
 * Tree-sitter extractor for PHP.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractPhp(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  // PHP root is 'program'; statements may be inside a php_tag block
  const stmts = root.type === "program" ? root.namedChildren : [root];

  for (const node of stmts) {
    processPhpNode(node, imports, exports, symbols, topLevelComments, source);
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function processPhpNode(
  node: SyntaxNode,
  imports: Import[],
  exports: string[],
  symbols: CodeSymbol[],
  topLevelComments: string[],
  source: string
): void {
  switch (node.type) {
    case "comment": {
      if (topLevelComments.length === 0) {
        const text = node.text.replace(/^\/\/\s*|^#\s*|^\/\*+\s*|\s*\*+\/$/g, "").trim();
        if (text.length > 5) topLevelComments.push(text);
      }
      break;
    }
    case "namespace_use_declaration": {
      const clauses = node.namedChildren.filter((c) => c.type === "namespace_use_clause" || c.type === "namespace_name");
      for (const clause of clauses) {
        const name = clause.type === "namespace_name" ? clause.text : (clause.namedChildren[0]?.text ?? clause.text);
        const alias = clause.namedChildren.find((c) => c.type === "namespace_aliasing_clause");
        const spec = alias?.namedChildren[0]?.text ?? name.split("\\").pop() ?? name;
        imports.push({ source: name, specifiers: [spec] });
      }
      break;
    }
    case "function_definition": {
      const nameNode = node.childForFieldName("name") ?? findChild(node, "name");
      if (!nameNode) break;
      symbols.push({
        name: nameNode.text,
        kind: "function",
        signature: buildPhpSignature(node, source),
        exported: true, // PHP top-level functions are always "public"
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
      });
      exports.push(nameNode.text);
      break;
    }
    case "class_declaration":
    case "abstract_class_declaration": {
      const nameNode = node.childForFieldName("name") ?? findChild(node, "name");
      if (!nameNode) break;
      symbols.push({
        name: nameNode.text,
        kind: "class",
        exported: true,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
      });
      exports.push(nameNode.text);
      break;
    }
    case "interface_declaration": {
      const nameNode = node.childForFieldName("name") ?? findChild(node, "name");
      if (!nameNode) break;
      symbols.push({
        name: nameNode.text,
        kind: "interface",
        exported: true,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
      });
      exports.push(nameNode.text);
      break;
    }
    case "trait_declaration": {
      const nameNode = node.childForFieldName("name") ?? findChild(node, "name");
      if (!nameNode) break;
      symbols.push({
        name: nameNode.text,
        kind: "trait",
        exported: true,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
      });
      exports.push(nameNode.text);
      break;
    }
  }
}

function buildPhpSignature(node: SyntaxNode, source: string): string {
  const body = node.childForFieldName("body") ?? findChild(node, "compound_statement");
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).trim().replace(/\s+/g, " ").slice(0, 300);
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}
