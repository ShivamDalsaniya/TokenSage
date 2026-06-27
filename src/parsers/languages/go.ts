/**
 * Tree-sitter extractor for Go.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractGo(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  // Go comments before package clause
  let foundPackage = false;
  for (const node of root.children) {
    if (node.type === "package_clause") { foundPackage = true; continue; }
    if (!foundPackage && node.type === "comment") {
      const text = node.text.replace(/^\/\/\s*/, "").trim();
      if (text.length > 5) topLevelComments.push(text);
    }
    if (node.type === "comment" && topLevelComments.length === 0) {
      const text = node.text.replace(/^\/\/\s*/, "").trim();
      if (text.length > 5) topLevelComments.push(text);
    }
  }

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "import_declaration": {
        // Could be single or block
        const specList = findChild(node, "import_spec_list");
        if (specList) {
          for (const spec of specList.namedChildren) {
            if (spec.type === "import_spec") {
              const imp = extractGoImportSpec(spec);
              if (imp) imports.push(imp);
            }
          }
        } else {
          const spec = findChild(node, "import_spec");
          if (spec) {
            const imp = extractGoImportSpec(spec);
            if (imp) imports.push(imp);
          }
        }
        break;
      }
      case "function_declaration": {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
        if (!nameNode) break;
        const name = nameNode.text;
        const exported = /^[A-Z]/.test(name);
        symbols.push({
          name,
          kind: "function",
          signature: buildGoSignature(node, source),
          exported,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (exported) exports.push(name);
        break;
      }
      case "method_declaration": {
        const nameNode = node.childForFieldName("name") ?? findChildByTypes(node, ["field_identifier", "identifier"]);
        if (!nameNode) break;
        const name = nameNode.text;
        const exported = /^[A-Z]/.test(name);
        symbols.push({
          name,
          kind: "method",
          signature: buildGoSignature(node, source),
          exported,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        if (exported) exports.push(name);
        break;
      }
      case "type_declaration": {
        for (const spec of node.namedChildren) {
          if (spec.type !== "type_spec") continue;
          const nameNode = spec.childForFieldName("name") ?? findChild(spec, "type_identifier");
          if (!nameNode) continue;
          const name = nameNode.text;
          const exported = /^[A-Z]/.test(name);
          const typeNode = spec.childForFieldName("type") ?? spec.namedChildren[1];
          let kind: CodeSymbol["kind"] = "type";
          if (typeNode?.type === "struct_type") kind = "struct";
          else if (typeNode?.type === "interface_type") kind = "interface";
          symbols.push({ name, kind, exported, lineStart: spec.startPosition.row + 1, lineEnd: spec.endPosition.row + 1 });
          if (exported) exports.push(name);
        }
        break;
      }
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function extractGoImportSpec(spec: SyntaxNode): Import | null {
  const pathNode = findChildByTypes(spec, ["interpreted_string_literal", "raw_string_literal"]);
  if (!pathNode) return null;
  const src = pathNode.text.replace(/^["` ]|["` ]$/g, "").replace(/"/g, "");
  const alias = findChild(spec, "identifier");
  if (alias?.text === "_") return { source: src, specifiers: [], isSideEffect: true };
  const name = alias?.text ?? src.split("/").pop() ?? src;
  return { source: src, specifiers: [name] };
}

function buildGoSignature(node: SyntaxNode, source: string): string {
  const body = node.childForFieldName("body") ?? findChild(node, "block");
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).trim().replace(/\s+/g, " ").slice(0, 300);
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}

function findChildByTypes(node: SyntaxNode, types: string[]): SyntaxNode | null {
  return node.children.find((c) => types.includes(c.type)) ?? null;
}
