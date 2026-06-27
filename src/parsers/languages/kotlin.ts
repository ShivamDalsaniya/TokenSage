/**
 * Tree-sitter extractor for Kotlin.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractKotlin(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "multiline_comment":
      case "line_comment": {
        if (topLevelComments.length === 0) {
          const text = node.text.replace(/^\/\*+\s*|\s*\*+\/$/g, "").replace(/^\/\/\s*/gm, "").split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).filter(Boolean).join(" ");
          if (text.length > 5) topLevelComments.push(text);
        }
        break;
      }
      case "import_header": {
        const path = node.namedChildren[0]?.text ?? node.text.replace(/^import\s+/, "").trim();
        const parts = path.split(".");
        const spec = path.endsWith(".*") ? "*" : (parts[parts.length - 1] ?? path);
        const src = path.endsWith(".*") ? path.slice(0, -2) : path;
        imports.push({ source: src, specifiers: [spec] });
        break;
      }
      case "import_list": {
        for (const imp of node.namedChildren) {
          if (imp.type === "import_header") {
            const path = imp.namedChildren[0]?.text ?? imp.text.replace(/^import\s+/, "").trim();
            const parts = path.split(".");
            const spec = path.endsWith(".*") ? "*" : (parts[parts.length - 1] ?? path);
            const src = path.endsWith(".*") ? path.slice(0, -2) : path;
            imports.push({ source: src, specifiers: [spec] });
          }
        }
        break;
      }
      case "function_declaration": {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "simple_identifier");
        if (!nameNode) break;
        const exported = !hasModifier(node, "private") && !hasModifier(node, "internal");
        const isAsync = hasModifier(node, "suspend");
        symbols.push({
          name: nameNode.text,
          kind: "function",
          exported,
          async: isAsync,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (exported) exports.push(nameNode.text);
        break;
      }
      case "class_declaration":
      case "object_declaration":
      case "companion_object": {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "simple_identifier") ?? findChild(node, "type_identifier");
        if (!nameNode) break;
        const exported = !hasModifier(node, "private") && !hasModifier(node, "internal");
        symbols.push({
          name: nameNode.text,
          kind: "class",
          exported,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (exported) exports.push(nameNode.text);
        break;
      }
      case "interface_declaration": {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "simple_identifier");
        if (!nameNode) break;
        const exported = !hasModifier(node, "private") && !hasModifier(node, "internal");
        symbols.push({
          name: nameNode.text,
          kind: "interface",
          exported,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (exported) exports.push(nameNode.text);
        break;
      }
      case "type_alias": {
        const nameNode = findChild(node, "simple_identifier") ?? findChild(node, "type_identifier");
        if (!nameNode) break;
        symbols.push({
          name: nameNode.text,
          kind: "type",
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

function hasModifier(node: SyntaxNode, modifier: string): boolean {
  const mods = node.childForFieldName("modifiers") ?? findChild(node, "modifiers");
  if (mods) return mods.children.some((c) => c.text === modifier);
  return node.children.some((c) => c.type === "modifier" && c.text === modifier);
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}
