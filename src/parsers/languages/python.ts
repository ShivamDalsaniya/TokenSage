/**
 * Tree-sitter extractor for Python.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractPython(root: SyntaxNode, _source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  // Detect __all__ for explicit export list
  const allExports = extractDunderAll(root);

  // Top-level docstring: first statement is expression_statement with string child
  const firstStmt = root.namedChildren[0];
  if (firstStmt?.type === "expression_statement") {
    const strNode = firstStmt.namedChildren[0];
    if (strNode?.type === "string") {
      const doctext = strNode.text.replace(/^['"`]{1,3}|['"`]{1,3}$/g, "").trim().split("\n")[0]?.trim() ?? "";
      if (doctext.length > 5) topLevelComments.push(doctext);
    }
  }

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "import_statement": {
        // import a, b, c
        for (const child of node.namedChildren) {
          const name = child.type === "dotted_name" ? child.text : child.type === "aliased_import" ? child.namedChildren[0]?.text ?? "" : child.text;
          if (name) imports.push({ source: name, specifiers: [name.split(".")[0] ?? name] });
        }
        break;
      }
      case "import_from_statement": {
        // from x import y, z
        const moduleNode = node.childForFieldName("module_name") ?? node.namedChildren[0];
        const src = moduleNode?.text ?? "";

        const importList = findChild(node, "wildcard_import") ?? findChild(node, "import_list");
        let specs: string[] = [];

        if (importList?.type === "wildcard_import") {
          specs = ["*"];
        } else if (importList?.type === "import_list") {
          for (const spec of importList.namedChildren) {
            const n = spec.type === "aliased_import" ? spec.namedChildren[0]?.text : spec.text;
            if (n) specs.push(n);
          }
        } else {
          // from x import y (single, no list node)
          for (let i = 1; i < node.namedChildren.length; i++) {
            const c = node.namedChildren[i];
            if (!c) continue;
            if (c === moduleNode) continue;
            const n = c.type === "aliased_import" ? c.namedChildren[0]?.text : c.text;
            if (n && n !== src) specs.push(n);
          }
        }
        imports.push({ source: src, specifiers: specs });
        break;
      }
      case "function_definition": {
        const sym = extractPyFunction(node, allExports);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "decorated_definition": {
        const inner = node.namedChildren.find((c) => c.type === "function_definition" || c.type === "class_definition" || c.type === "async_function_definition");
        if (!inner) break;
        if (inner.type === "function_definition" || inner.type === "async_function_definition") {
          const sym = extractPyFunction(inner, allExports);
          if (sym) {
            sym.lineStart = node.startPosition.row + 1; // include decorator line
            symbols.push(sym);
            if (sym.exported) exports.push(sym.name);
          }
        } else {
          const sym = extractPyClass(inner, allExports);
          if (sym) {
            sym.lineStart = node.startPosition.row + 1;
            symbols.push(sym);
            if (sym.exported) exports.push(sym.name);
          }
        }
        break;
      }
      case "async_function_definition": {
        const sym = extractPyFunction(node, allExports);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "class_definition": {
        const sym = extractPyClass(node, allExports);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
    }
  }

  // If __all__ defined, filter exports to only those listed
  if (allExports !== null) {
    for (const sym of symbols) {
      sym.exported = allExports.has(sym.name);
    }
    return { imports, exports: [...allExports], symbols, topLevelComments, hasDefaultExport: false };
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function extractPyFunction(node: SyntaxNode, allExports: Set<string> | null): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
  if (!nameNode) return null;
  const name = nameNode.text;
  const isAsync = node.type === "async_function_definition" || node.children.some((c) => c.type === "async");
  const exported = allExports ? allExports.has(name) : !name.startsWith("_");
  return {
    name,
    kind: "function",
    exported,
    async: isAsync,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractPyClass(node: SyntaxNode, allExports: Set<string> | null): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
  if (!nameNode) return null;
  const name = nameNode.text;
  const exported = allExports ? allExports.has(name) : !name.startsWith("_");
  return {
    name,
    kind: "class",
    exported,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractDunderAll(root: SyntaxNode): Set<string> | null {
  for (const node of root.namedChildren) {
    if (node.type !== "expression_statement") continue;
    const assign = node.namedChildren[0];
    if (!assign || assign.type !== "assignment") continue;
    const left = assign.childForFieldName("left") ?? assign.namedChildren[0];
    if (!left || left.text !== "__all__") continue;
    const right = assign.childForFieldName("right") ?? assign.namedChildren[1];
    if (!right || right.type !== "list") continue;
    const names = new Set<string>();
    for (const item of right.namedChildren) {
      if (item.type === "string") {
        const text = item.text.replace(/^['"]|['"]$/g, "");
        if (text) names.add(text);
      }
    }
    return names;
  }
  return null;
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}
