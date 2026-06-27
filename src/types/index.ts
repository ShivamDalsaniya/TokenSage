// Core types for TokenSage MCP server

export interface TokenCount {
  original: number;
  optimized: number;
  saved: number;
  savedPercent: number;
}

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "method" | "variable" | "interface" | "type" | "enum" | "constant" | "struct" | "trait" | "protocol";
  signature?: string;
  exported: boolean;
  async?: boolean;
  lineStart?: number;
  lineEnd?: number;
}

export interface Import {
  source: string;
  specifiers: string[];
  isDefault?: boolean;
  isSideEffect?: boolean;
}

export interface CompressedFile {
  path: string;
  language: string;
  purpose: string;
  imports: Import[];
  exports: string[];
  symbols: CodeSymbol[];
  dependencies: string[];
  summary: string;
  tokens: TokenCount;
}

export interface DirectoryNode {
  path: string;
  type: "file" | "directory";
  children?: DirectoryNode[];
  language?: string;
  size?: number;
}

export interface CompressedDirectory {
  path: string;
  architecture: string;
  entryPoints: string[];
  dependencyGraph: Record<string, string[]>;
  fileRelationships: Array<{ from: string; to: string; relationship: string }>;
  importantFiles: Array<{ path: string; reason: string }>;
  techStack: string[];
  summary: string;
  tokens: TokenCount;
}

export interface LogEntry {
  level: "error" | "warn" | "info" | "debug";
  message: string;
  timestamp?: string;
  count?: number;
}

export interface CompressedLogs {
  status: "success" | "warning" | "error" | "unknown";
  errors: LogEntry[];
  warnings: LogEntry[];
  summary: string;
  recommendedActions: string[];
  tokens: TokenCount;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface CompressedConversation {
  goals: string[];
  completedTasks: string[];
  pendingTasks: string[];
  decisions: string[];
  blockers: string[];
  keyContext: string;
  tokens: TokenCount;
}

export interface DuplicateGroup {
  hash: string;
  type: "stack-trace" | "file" | "tool-output" | "message" | "context-chunk";
  count: number;
  items: string[];
  representative: string;
}

export interface DeduplicatedResult {
  originalCount: number;
  deduplicatedCount: number;
  groups: DuplicateGroup[];
  items: string[];
  tokens: TokenCount;
}

export interface FileRelevance {
  path: string;
  score: number;
  reasons: string[];
}

export interface SemanticRelevanceResult {
  query: string;
  results: FileRelevance[];
  tokens: TokenCount;
}

export interface ContextBudget {
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  savedPercent: number;
  breakdown: Array<{ item: string; originalTokens: number; optimizedTokens: number }>;
  recommendation: string;
}

export interface SessionStats {
  sessionId: string;
  startedAt: string;
  totalRequests: number;
  totalOriginalTokens: number;
  totalOptimizedTokens: number;
  totalSavedTokens: number;
  savedPercent: number;
  toolUsage: Record<string, number>;
}

export interface TokenUsageReport {
  currentRequest?: TokenCount;
  currentSession: SessionStats;
  allTimeSaved: number;
  topSavingTools: Array<{ tool: string; savedTokens: number }>;
}

export interface ParsedCode {
  language: string;
  imports: Import[];
  exports: string[];
  symbols: CodeSymbol[];
  topLevelComments: string[];
  hasDefaultExport: boolean;
}

export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "cpp"
  | "c"
  | "ruby"
  | "php"
  | "swift"
  | "kotlin"
  | "unknown";
