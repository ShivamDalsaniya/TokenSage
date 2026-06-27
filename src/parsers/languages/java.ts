/**
 * Tree-sitter extractor for Java.
 */
import type { SyntaxNode, ExtractResult } from "../tree-sitter-types.js";
import type { Import, CodeSymbol } from "../../types/index.js";

export function extractJava(root: SyntaxNode, source: string): ExtractResult {
  const imports: Import[] = [];
  const exports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const topLevelComments: string[] = [];

  for (const node of root.namedChildren) {
    switch (node.type) {
      case "block_comment":
      case "line_comment": {
        if (topLevelComments.length === 0) {
          const text = node.text
            .replace(/^\/\*+\s*|\s*\*+\/$/g, "")
            .replace(/^\/\/\s*/gm, "")
            .split("\n")
            .map((l) => l.replace(/^\s*\*\s?/, "").trim())
            .filter(Boolean)
            .join(" ");
          if (text.length > 5) topLevelComments.push(text);
        }
        break;
      }
      case "import_declaration": {
        const isStatic = node.children.some((c) => c.text === "static");
        // The module path is a scoped_identifier or identifier
        const pathNode = findChildByTypes(node, ["scoped_identifier", "identifier", "asterisk"]);
        const text = node.text.replace(/^import\s+(static\s+)?/, "").replace(/;$/, "").trim();
        const parts = text.split(".");
        const src = isStatic ? parts.slice(0, -1).join(".") : text;
        const spec = parts[parts.length - 1] ?? "*";
        imports.push({ source: src, specifiers: spec === "*" ? ["*"] : [spec] });
        break;
      }
      case "class_declaration":
      case "record_declaration": {
        const sym = extractJavaType(node, "class", source);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
          // Extract public methods
          extractJavaMethods(node, symbols, source);
        }
        break;
      }
      case "interface_declaration": {
        const sym = extractJavaType(node, "interface", source);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "enum_declaration": {
        const sym = extractJavaType(node, "enum", source);
        if (sym) {
          symbols.push(sym);
          if (sym.exported) exports.push(sym.name);
        }
        break;
      }
      case "annotation_type_declaration": {
        const nameNode = findChild(node, "identifier");
        if (!nameNode) break;
        const exported = hasPublicModifier(node);
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
    }
  }

  return { imports, exports: [...new Set(exports)], symbols, topLevelComments, hasDefaultExport: false };
}

function extractJavaType(node: SyntaxNode, kind: CodeSymbol["kind"], _source: string): CodeSymbol | null {
  const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
  if (!nameNode) return null;
  const exported = hasPublicModifier(node);
  return {
    name: nameNode.text,
    kind,
    exported,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function extractJavaMethods(classNode: SyntaxNode, symbols: CodeSymbol[], source: string): void {
  const body = classNode.childForFieldName("body") ?? findChild(classNode, "class_body");
  if (!body) return;
  for (const member of body.namedChildren) {
    if (member.type !== "method_declaration" && member.type !== "constructor_declaration") continue;
    if (!hasPublicModifier(member)) continue;
    const nameNode = member.childForFieldName("name") ?? findChild(member, "identifier");
    if (!nameNode) continue;
    const isAsync = false; // Java doesn't have async in this sense
    symbols.push({
      name: nameNode.text,
      kind: "method",
      signature: buildJavaSignature(member, source),
      exported: false,
      lineStart: member.startPosition.row + 1,
      lineEnd: member.endPosition.row + 1,
    });
  }
}

function hasPublicModifier(node: SyntaxNode): boolean {
  const modifiers = node.childForFieldName("modifiers") ?? findChild(node, "modifiers");
  if (modifiers) return modifiers.children.some((c) => c.text === "public");
  // Sometimes modifiers are direct children
  return node.children.some((c) => c.type === "modifier" && c.text === "public");
}

function buildJavaSignature(node: SyntaxNode, source: string): string {
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
