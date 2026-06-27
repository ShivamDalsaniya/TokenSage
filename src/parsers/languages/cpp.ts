/**
 * Tree-sitter extractor for C and C++.
 * Shared extractor — same grammar handles both dialects.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractCpp(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "comment": {
        if (topLevelComments.length === 0) {
          const text = node.text.replace(/^\/\/\s*|^\/\*+\s*|\s*\*+\/$/g, "").trim();
          if (text.length > 5) topLevelComments.push(text);
        }
        break;
      }
      case "preproc_include": {
        const pathNode = findChildByTypes(node, ["string_literal", "system_lib_string"]);
        if (!pathNode) break;
        const src = pathNode.text.replace(/^["<]|[">]$/g, "");
        imports.push({ source: src, specifiers: [src.split("/").pop() ?? src] });
        break;
      }
      case "function_definition": {
        const sym = extractCppFunction(node, source);
        if (sym) { symbols.push(sym); if (sym.exported) exports.push(sym.name); }
        break;
      }
      case "declaration": {
        // Forward declarations / function prototypes
        const nameNode = findDeclaratorName(node);
        if (!nameNode) break;
        const isStatic = node.children.some((c) => c.text === "static");
        symbols.push({
          name: nameNode.text,
          kind: "function",
          exported: !isStatic,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (!isStatic) exports.push(nameNode.text);
        break;
      }
      case "class_specifier": {
        const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["type_identifier", "identifier"]);
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
      case "struct_specifier": {
        const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["type_identifier", "identifier"]);
        if (!nameNode) break;
        // Only register if it has a body (definition, not just a type reference)
        if (!findChild(node, "field_declaration_list")) break;
        symbols.push({
          name: nameNode.text,
          kind: "struct",
          exported: true,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        exports.push(nameNode.text);
        break;
      }
      case "enum_specifier": {
        const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["type_identifier", "identifier"]);
        if (!nameNode) break;
        symbols.push({
          name: nameNode.text,
          kind: "enum",
          exported: true,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        exports.push(nameNode.text);
        break;
      }
      case "type_definition": {
        // typedef struct/enum/...
        const nameNode = findChildByTypes(node, ["type_identifier"]);
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
      case "namespace_definition": {
        // C++ namespace — recurse into body
        const body = node.childForFieldName("body") ?? findChild(node, "declaration_list");
        if (body) {
          for (const child of body.namedChildren) {
            if (child.type === "function_definition") {
              const sym = extractCppFunction(child, source);
              if (sym) { symbols.push(sym); if (sym.exported) exports.push(sym.name); }
            }
          }
        }
        break;
      }
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function extractCppFunction(node: SyntaxNode, source: string): CodeSymbol | null {
  const declarator = node.childForFieldName("declarator") ?? findChildByTypes(node, ["function_declarator", "pointer_declarator"]);
  if (!declarator) return null;

  let nameNode = declarator.childForFieldName("declarator") ?? findChildByTypes(declarator, ["identifier", "qualified_identifier", "scoped_identifier"]);
  // For pointer_declarator, go deeper
  if (!nameNode) nameNode = findChildByTypes(node, ["identifier"]);
  if (!nameNode) return null;

  const isStatic = node.children.some((c) => c.text === "static");
  const body = node.childForFieldName("body") ?? findChild(node, "compound_statement");
  const end = body ? body.startIndex : node.endIndex;
  const sig = source.slice(node.startIndex, end).trim().replace(/\s+/g, " ").slice(0, 300);

  return {
    name: nameNode.text,
    kind: "function",
    signature: sig,
    exported: !isStatic,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function findDeclaratorName(node: SyntaxNode): SyntaxNode | null {
  // For function prototypes: declaration > function_declarator > identifier
  const funcDecl = findChild(node, "function_declarator");
  if (funcDecl) {
    return funcDecl.childForFieldName("declarator") ?? findChildByTypes(funcDecl, ["identifier"]);
  }
  return null;
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}

function findChildByTypes(node: SyntaxNode, types: string[]): SyntaxNode | null {
  return node.children.find((c) => types.includes(c.type)) ?? null;
}
