/**
 * Tree-sitter extractor for Ruby.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractRuby(root: SyntaxNode, _source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "comment": {
        if (topLevelComments.length === 0) {
          const text = node.text.replace(/^#\s*/, "").trim();
          if (text.length > 5) topLevelComments.push(text);
        }
        break;
      }
      case "call": {
        // require 'foo' / require_relative 'bar'
        const method = node.childForFieldName("method") ?? findChild(node, "identifier");
        if (!method || (method.text !== "require" && method.text !== "require_relative")) break;
        const args = node.childForFieldName("arguments") ?? findChild(node, "argument_list");
        if (!args) break;
        const strNode = findChildByTypes(args, ["string", "simple_symbol"]);
        if (!strNode) break;
        const src = strNode.text.replace(/^['":]/g, "").replace(/['"]$/g, "");
        imports.push({ source: src, specifiers: [src.split("/").pop() ?? src] });
        break;
      }
      case "method": {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
        if (!nameNode) break;
        const name = nameNode.text;
        symbols.push({
          name,
          kind: "function",
          exported: !name.startsWith("_"),
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (!name.startsWith("_")) exports.push(name);
        break;
      }
      case "singleton_method": {
        const nameNode = findChildByTypes(node, ["identifier", "operator"]);
        if (!nameNode) break;
        symbols.push({
          name: nameNode.text,
          kind: "method",
          exported: true,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        exports.push(nameNode.text);
        break;
      }
      case "class":
      case "singleton_class": {
        const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["constant", "scope_resolution"]);
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
      case "module": {
        const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["constant", "scope_resolution"]);
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
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}

function findChildByTypes(node: SyntaxNode, types: string[]): SyntaxNode | null {
  return node.children.find((c) => types.includes(c.type)) ?? null;
}
