/**
 * Minimal local type stubs for tree-sitter, loaded via createRequire.
 * These mirror the runtime API without requiring the tree-sitter package types.
 */

export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childCount: number;
  namedChildCount: number;
  hasError: boolean;
  isMissing: boolean;
  isNamed: boolean;
  parent: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
  child(index: number): SyntaxNode | null;
  namedChild(index: number): SyntaxNode | null;
}

export interface Tree {
  rootNode: SyntaxNode;
}

export interface TreeSitterParser {
  setLanguage(language: unknown): void;
  parse(source: string): Tree;
}

export interface TreeSitterParserConstructor {
  new (): TreeSitterParser;
}

export type Extractor = (root: SyntaxNode, source: string) => ExtractResult;

export interface ExtractResult {
  imports: import("../types/index.js").Import[];
  exports: string[];
  symbols: import("../types/index.js").CodeSymbol[];
  topLevelComments: string[];
  hasDefaultExport: boolean;
}
